/**
 * Thin wrappers around the `oxen` CLI for clone detection and local commits.
 */
import { spawn, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import {
  authHostFromRemote,
  resolveRemote,
  resolveToken,
} from './config.mjs'

/**
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, oxenConfigDir?: string }} [opts]
 */
export function runOxen(args, opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const env = { ...(opts.env || process.env) }
  if (opts.oxenConfigDir) {
    env.OXEN_CONFIG_DIR = opts.oxenConfigDir
  }
  const r = spawnSync('oxen', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    env,
  })
  return {
    code: r.status ?? 1,
    stdout: (r.stdout || '').trim(),
    stderr: (r.stderr || '').trim(),
    error: r.error,
  }
}

/** Walk up from startDir looking for `.oxen`. */
export function findOxenRoot(startDir = process.cwd()) {
  let dir = resolve(startDir)
  for (;;) {
    if (existsSync(join(dir, '.oxen'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/**
 * Parse `oxen remote --verbose` / config for origin URL → namespace + repo.
 * Accepts URLs like http://host:8080/ns/repo or https://hub.oxen.ai/ns/repo
 */
export function parseRemoteUrl(url) {
  const raw = String(url || '').trim().replace(/\/+$/, '')
  if (!raw) return null
  try {
    const u = new URL(raw.includes('://') ? raw : `https://${raw}`)
    const parts = u.pathname.split('/').filter(Boolean)
    if (parts.length < 2) return null
    return {
      namespace: decodeURIComponent(parts[parts.length - 2]),
      repo: decodeURIComponent(parts[parts.length - 1]),
      remoteUrl: raw,
    }
  } catch {
    return null
  }
}

function remoteFromConfigToml(root) {
  const candidates = [
    join(root, '.oxen', 'config.toml'),
    join(root, '.oxen', 'remote.toml'),
  ]
  for (const p of candidates) {
    if (!existsSync(p)) continue
    const text = readFileSync(p, 'utf8')
    const urlMatch = text.match(
      /(?:url|remote)\s*=\s*["']([^"']+)["']/i,
    )
    if (urlMatch?.[1]) {
      const parsed = parseRemoteUrl(urlMatch[1])
      if (parsed) return parsed
    }
    // oxen sometimes stores path-style remotes
    const pathMatch = text.match(
      /(?:name|path)\s*=\s*["']([^/"']+)\/([^/"']+)["']/,
    )
    if (pathMatch) {
      return {
        namespace: pathMatch[1],
        repo: pathMatch[2],
        remoteUrl: '',
      }
    }
  }
  return null
}

export function detectRemote(root) {
  const verbose = runOxen(['remote', '--verbose'], { cwd: root })
  if (verbose.code === 0 && verbose.stdout) {
    // Formats vary: "origin\thttp://..." or "origin http://..."
    for (const line of verbose.stdout.split('\n')) {
      const m = line.match(
        /(?:^|\s)(https?:\/\/\S+|oxen:\/\/\S+)/i,
      )
      if (m) {
        const parsed = parseRemoteUrl(m[1])
        if (parsed) return parsed
      }
    }
  }
  return remoteFromConfigToml(root)
}

/** Current branch name, or '' if detached / unknown. */
export function currentBranch(root) {
  const r = runOxen(['branch'], { cwd: root })
  if (r.code !== 0) return ''
  for (const line of r.stdout.split('\n')) {
    const star = line.match(/^\*\s+(\S+)/)
    if (star) return star[1]
    const cur = line.match(/^current(?: branch)?:\s*(\S+)/i)
    if (cur) return cur[1]
  }
  // Single-line name only
  const only = r.stdout.trim()
  if (only && !only.includes('\n') && !/\s/.test(only)) return only
  return ''
}

/** HEAD commit id. */
export function headCommit(root) {
  // Try common flags; fall back to parsing log.
  for (const args of [
    ['log', '-n', '1', '--oneline'],
    ['log', '-1'],
    ['log'],
  ]) {
    const r = runOxen(args, { cwd: root })
    if (r.code !== 0 || !r.stdout) continue
    const hex = r.stdout.match(/\b([0-9a-f]{16,64})\b/i)
    if (hex) return hex[1].toLowerCase()
  }
  return ''
}

/**
 * Worktree is clean if status reports no pending changes.
 * Conservative: non-zero exit or keywords like modified/untracked/staged → dirty.
 */
export function isWorktreeClean(root) {
  const r = runOxen(['status'], { cwd: root })
  if (r.error) {
    return { clean: false, detail: `oxen not available: ${r.error.message}` }
  }
  if (r.code !== 0) {
    return {
      clean: false,
      detail: r.stderr || r.stdout || `oxen status exited ${r.code}`,
    }
  }
  const text = `${r.stdout}\n${r.stderr}`.toLowerCase()
  if (
    /nothing to commit|clean working|no changes|up to date/.test(text) &&
    !/modified|untracked|staged|removed|added:/.test(text)
  ) {
    return { clean: true, detail: '' }
  }
  // Empty status often means clean
  if (!r.stdout.trim()) return { clean: true, detail: '' }
  // If status lists file changes, treat as dirty
  if (
    /modified|untracked|staged|removed|changes to be committed|not staged/.test(
      text,
    )
  ) {
    return { clean: false, detail: r.stdout || 'worktree has local changes' }
  }
  // Ambiguous but non-empty: require explicit clean phrases else dirty
  return { clean: false, detail: r.stdout || 'worktree not clean' }
}

export function oxenAdd(root, paths, opts = {}) {
  const args = ['add', ...paths]
  const r = runOxen(args, { cwd: root, oxenConfigDir: opts.oxenConfigDir })
  if (r.code !== 0) {
    throw new Error(`oxen add failed: ${r.stderr || r.stdout}`)
  }
}

/**
 * Job/local commits use a dedicated config dir under `.boxen/` so we are not
 * broken by a stale ambient `OXEN_CONFIG_DIR`, missing home config, or the
 * unsupported `oxen config --list` flag.
 */
export function oxenIdentityDir(root) {
  return join(root, '.boxen', 'oxen-config')
}

export function userConfigPath(root) {
  return join(oxenIdentityDir(root), 'user_config.toml')
}

/** Strip characters that break a simple TOML basic string. */
function sanitizeIdentField(value) {
  return String(value)
    .replace(/[\r\n"]/g, ' ')
    .trim()
}

/** @returns {{ name: string, email: string } | null} */
export function readOxenIdentity(root) {
  const path = userConfigPath(root)
  if (!existsSync(path)) return null
  try {
    const text = readFileSync(path, 'utf8')
    const name = text.match(/^\s*name\s*=\s*"([^"]*)"/m)?.[1]?.trim()
    const email = text.match(/^\s*email\s*=\s*"([^"]*)"/m)?.[1]?.trim()
    if (name && email) return { name, email }
  } catch {
    /* ignore */
  }
  return null
}

/**
 * Ensure commit author identity for `oxen commit` via OXEN_CONFIG_DIR.
 * Returns `{ oxenConfigDir }` that callers must pass to subsequent oxen calls.
 */
export function ensureOxenIdentity(root, actor = {}) {
  const configDir = oxenIdentityDir(root)
  const existing = readOxenIdentity(root)
  if (existing) {
    return {
      ok: true,
      configured: false,
      oxenConfigDir: configDir,
      ...existing,
    }
  }

  const name =
    sanitizeIdentField(actor.name || actor.email || '') || 'boxen'
  const email = sanitizeIdentField(actor.email || '') || 'boxen@localhost'
  const body = `name = "${name}"\nemail = "${email}"\n`

  try {
    mkdirSync(configDir, { recursive: true })
    writeFileSync(userConfigPath(root), body, 'utf8')
  } catch (err) {
    return {
      ok: false,
      detail:
        err instanceof Error
          ? err.message
          : 'failed to write user_config.toml',
    }
  }

  const verified = readOxenIdentity(root)
  if (!verified) {
    return {
      ok: false,
      detail:
        'oxen identity missing after write; run: oxen config --name YOUR_NAME --email YOUR_EMAIL',
    }
  }
  return {
    ok: true,
    configured: true,
    oxenConfigDir: configDir,
    name: verified.name,
    email: verified.email,
  }
}

/** Restore working tree to HEAD (discard uncommitted changes). */
export function oxenRestore(root, path = '.') {
  const r = runOxen(['restore', path], { cwd: root })
  if (r.code !== 0) {
    // Older oxen may use different flags; try without path
    const r2 = runOxen(['restore'], { cwd: root })
    if (r2.code !== 0) {
      return {
        ok: false,
        detail: r2.stderr || r.stderr || r.stdout || 'oxen restore failed',
      }
    }
  }
  return { ok: true, detail: '' }
}

export function oxenCommit(root, message, opts = {}) {
  const r = runOxen(['commit', '-m', message], {
    cwd: root,
    oxenConfigDir: opts.oxenConfigDir,
  })
  if (r.code !== 0) {
    throw new Error(`oxen commit failed: ${r.stderr || r.stdout}`)
  }
  return headCommit(root)
}

export function oxenFetch(root) {
  runOxen(['fetch'], { cwd: root })
}

export function oxenPush(root, remote, branch) {
  const args = ['push']
  if (remote) args.push(remote)
  if (branch) args.push(branch)
  const r = runOxen(args, { cwd: root })
  if (r.code !== 0) {
    throw new Error(`oxen push failed: ${r.stderr || r.stdout}`)
  }
}

/** Merge `other` into current branch. Returns false if conflicts. */
export function oxenMerge(root, other) {
  const r = runOxen(['merge', other], { cwd: root })
  if (r.code !== 0) {
    return {
      ok: false,
      detail: r.stderr || r.stdout || 'merge failed',
    }
  }
  return { ok: true, detail: '' }
}

export function oxenCheckout(root, ref) {
  const r = runOxen(['checkout', ref], { cwd: root })
  if (r.code !== 0) {
    throw new Error(`oxen checkout ${ref} failed: ${r.stderr || r.stdout}`)
  }
}

/** Create branch from current HEAD if missing, then checkout. */
export function oxenCheckoutBranch(root, branch) {
  const list = runOxen(['branch'], { cwd: root })
  const has = list.stdout.split('\n').some((l) => {
    const name = l.replace(/^\*\s*/, '').trim().split(/\s+/)[0]
    return name === branch
  })
  if (!has) {
    const c = runOxen(['checkout', '-b', branch], { cwd: root })
    if (c.code !== 0) {
      throw new Error(
        `oxen checkout -b ${branch} failed: ${c.stderr || c.stdout}`,
      )
    }
    return
  }
  oxenCheckout(root, branch)
}

/**
 * Relative path of cwd within repo root ('' = root).
 */
export function relWorkdir(root, cwd = process.cwd()) {
  const rel = relative(root, resolve(cwd))
  if (rel.startsWith('..') || rel.startsWith(`..${sep}`)) {
    throw new Error('cwd is outside oxen repository')
  }
  return rel === '' ? '' : rel.split(sep).join('/')
}

/** Snapshot file digests under dir (skip .oxen / .boxen). */
export function snapshotTree(dir) {
  const out = new Map()
  const walk = (base, prefix) => {
    let entries
    try {
      entries = readdirSync(base, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of entries) {
      const name = ent.name
      if (name === '.oxen' || name === '.boxen' || name === '.boxen-job') continue
      const full = join(base, name)
      const rel = prefix ? `${prefix}/${name}` : name
      if (ent.isDirectory()) walk(full, rel)
      else if (ent.isFile()) {
        try {
          const st = statSync(full)
          out.set(rel, `${st.size}:${st.mtimeMs}`)
        } catch {
          /* skip */
        }
      }
    }
  }
  walk(dir, '')
  return out
}

export function diffSnapshots(before, after) {
  const added = []
  const modified = []
  const removed = []
  for (const [p, h] of after) {
    if (!before.has(p)) added.push(p)
    else if (before.get(p) !== h) modified.push(p)
  }
  for (const p of before.keys()) {
    if (!after.has(p)) removed.push(p)
  }
  return { added, modified, removed }
}

/** @returns {string | null} */
export function findOxen() {
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', [
    'oxen',
  ], {
    encoding: 'utf8',
  })
  if (which.status === 0) {
    const line = which.stdout.trim().split(/\r?\n/)[0]
    return line || null
  }
  return null
}

export function oxenVersion() {
  const bin = findOxen()
  if (!bin) return null
  const r = spawnSync(bin, ['--version'], { encoding: 'utf8' })
  if (r.status !== 0) return null
  return (r.stdout || r.stderr || '').trim() || null
}

/**
 * Configure oxen auth for the BFF host with a PAT.
 * @param {string} authHost
 * @param {string} token
 */
export function oxenConfigAuth(authHost, token) {
  const bin = findOxen()
  if (!bin) throw new Error('oxen CLI not found on PATH')
  const r = spawnSync(bin, ['config', '--auth', authHost, token], {
    encoding: 'utf8',
  })
  if (r.status !== 0) {
    throw new Error(
      (r.stderr || r.stdout || `oxen config --auth failed (${r.status})`).trim(),
    )
  }
}

/**
 * @param {string} name
 * @param {string} email
 */
export function oxenConfigUser(name, email) {
  const bin = findOxen()
  if (!bin) return
  if (name) {
    spawnSync(bin, ['config', '--name', name], { encoding: 'utf8' })
  }
  if (email) {
    spawnSync(bin, ['config', '--email', email], { encoding: 'utf8' })
  }
}

/**
 * True if URL host:port looks like the raw oxen-server publish port.
 * @param {string} urlOrHost
 */
export function looksLikeDirectOxenServer(urlOrHost) {
  try {
    const u = urlOrHost.includes('://')
      ? new URL(urlOrHost)
      : new URL(`http://${urlOrHost}`)
    return u.port === '3001' || u.host.endsWith(':3001')
  } catch {
    return /:3001\b/.test(urlOrHost)
  }
}

/**
 * Rewrite argv URLs that target :3001 to the configured BFF remote.
 * @param {string[]} args
 * @param {string} bffRemote
 * @returns {{ args: string[], rewritten: boolean, blocked?: string }}
 */
export function rewriteArgsForBff(args, bffRemote) {
  const remote = bffRemote.replace(/\/$/, '')
  let rewritten = false
  /** @type {string | undefined} */
  let blocked
  const next = args.map((arg) => {
    if (!/^https?:\/\//i.test(arg)) return arg
    if (!looksLikeDirectOxenServer(arg)) return arg
    try {
      const u = new URL(arg)
      const bff = new URL(remote)
      // Preserve path (/ns/repo) on the BFF host
      const path = u.pathname + u.search + u.hash
      rewritten = true
      return `${bff.origin}${path === '/' ? '' : path}`
    } catch {
      blocked = arg
      return arg
    }
  })
  return { args: next, rewritten, blocked }
}

/**
 * Ensure oxen auth is configured for the BFF before passthrough.
 * @param {string} [remote]
 */
export function ensureOxenAuth(remote) {
  const r = resolveRemote({ remote })
  const host = authHostFromRemote(r)
  const token = resolveToken()
  if (!token) {
    throw new Error(
      `Not logged in for ${host}. Run: boxen login\n(Or set BOXEN_PAT for automation.)`,
    )
  }
  oxenConfigAuth(host, token)
  return { remote: r, authHost: host, token }
}

/**
 * Spawn oxen with argv; inherit stdio; resolve with exit code.
 * @param {string[]} args
 * @returns {Promise<number>}
 */
export function runOxenPassthrough(args) {
  const bin = findOxen()
  if (!bin) {
    console.error(
      'boxen: oxen CLI not found on PATH.\nInstall Oxen (https://docs.oxen.ai), then run: boxen login',
    )
    return Promise.resolve(127)
  }
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: 'inherit' })
    child.on('error', (err) => {
      console.error(`boxen: failed to run oxen: ${err.message}`)
      resolve(127)
    })
    child.on('close', (code, signal) => {
      if (signal) resolve(1)
      else resolve(code ?? 1)
    })
  })
}
