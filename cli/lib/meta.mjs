import { api } from './api.mjs'

export const META_TYPES = [
  'namespace',
  'repo',
  'branch',
  'commit',
  'directory',
  'file',
  'workspace',
  'job',
  'session',
]

const SEP = {
  branch: '@',
  commit: '#',
  workspace: '!',
  file: ':',
  directory: ':',
}

const VALUE_FLAGS = new Set([
  'scope',
  'revision',
  'tag',
  'untag',
  'label',
  'unlabel',
  'remote',
  'token',
  'namespace',
  'repo',
])
const BOOL_FLAGS = new Set(['own', 'json', 'yes'])

/**
 * Parse `mice meta` args. Unlike parseArgs, --tag/--untag/--label/--unlabel
 * can repeat, and values may be comma separated (--tag a,b).
 * @param {string[]} argv
 */
export function parseMetaArgs(argv) {
  const out = {
    _: [],
    tags: [],
    untags: [],
    labels: [],
    unlabels: [],
    flags: {},
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) {
      out._.push(a)
      continue
    }
    const eq = a.indexOf('=')
    const key = eq > 2 ? a.slice(2, eq) : a.slice(2)
    if (BOOL_FLAGS.has(key)) {
      out.flags[key] = true
      continue
    }
    if (!VALUE_FLAGS.has(key)) throw new Error(`Unknown option --${key}`)
    const value = eq > 2 ? a.slice(eq + 1) : argv[++i]
    if (value == null) throw new Error(`Missing value for --${key}`)
    if (key === 'tag') out.tags.push(...splitList(value).map(t => t.toLowerCase()))
    else if (key === 'untag') out.untags.push(...splitList(value).map(t => t.toLowerCase()))
    else if (key === 'label') out.labels.push(value)
    else if (key === 'unlabel') out.unlabels.push(...splitList(value).map(k => k.toLowerCase()))
    else out.flags[key] = value
  }
  return out
}

function splitList(v) {
  return String(v)
    .split(',')
    .map((s) => s.trim().replace(/^#/, ''))
    .filter(Boolean)
}

/**
 * Build the PUT /auth/meta patch from parsed args.
 * @param {ReturnType<typeof parseMetaArgs>} p
 */
export function buildPatch(p) {
  const patch = {}
  const dup = p.tags.filter((t) => p.untags.includes(t))
  if (dup.length) throw new Error(`Tag both added and removed: ${dup[0]}`)
  if (p.tags.length) patch.tags = p.tags
  if (p.labels.length) {
    patch.labels = {}
    for (const raw of p.labels) {
      const eq = raw.indexOf('=')
      if (eq < 1) throw new Error(`Label must be key=value: ${raw}`)
      Object.defineProperty(patch.labels, raw.slice(0, eq).trim().toLowerCase(), { value: raw.slice(eq + 1), enumerable: true, writable: true, configurable: true })
    }
  }
  if (p.unlabels.length) {
    const clash = p.unlabels.find((k) => patch.labels && Object.hasOwn(patch.labels, k))
    if (clash) throw new Error(`Label both set and removed: ${clash}`)
    patch.labels = { ...patch.labels, ...Object.fromEntries(p.unlabels.map(k => [k, null])) }
  }
  return patch
}

/**
 * Turn the user's id into a full entity id, filling in namespace/repo from the
 * current clone for repo-scoped types (ctx is lazy: only called when needed).
 * @param {string} type
 * @param {string | undefined} id
 * @param {() => { namespace: string, repo: string, branch?: string }} ctx
 */
export function resolveEntityId(type, id, ctx) {
  if (!META_TYPES.includes(type)) {
    throw new Error(`Unknown entity type "${type}". One of: ${META_TYPES.join(', ')}`)
  }
  let out = id
  if (type === 'job' || type === 'session') {
    if (!out) throw new Error(`${type} id is required`)
    return out
  }
  if (type === 'namespace') return out || ctx().namespace
  const repoCtx = () => {
    const c = ctx()
    if (!c.repo) throw new Error('Could not detect repo; run inside a clone or pass --repo')
    return c
  }
  if (type === 'repo') {
    if (out) return out
    const c = repoCtx()
    return `${c.namespace}/${c.repo}`
  }
  const sep = SEP[type]
  if (!out) {
    if (type === 'branch') {
      const c = repoCtx()
      if (!c.branch) throw new Error('Could not detect the current branch')
      out = `${c.namespace}/${c.repo}@${c.branch}`
    } else {
      throw new Error(`${type} id is required`)
    }
  } else if (!/^[^/\s]+\/[^/\s@#:!]+[@#:!]/.test(out)) {
    const c = repoCtx()
    out = `${c.namespace}/${c.repo}${sep}${out}`
  }
  if (type === 'directory' && !out.endsWith('/')) out += '/'
  return out
}

function formatMeta(res, own) {
  const lines = [`${res.ref.type} ${res.ref.id}${res.ref.scope ? ` (${res.ref.scope.kind}: ${res.ref.scope.id})` : ''}`]
  const section = own ? res.own : res.effective
  const tags = own ? (res.own?.tags ?? []) : (section?.tags ?? [])
  const labels = own ? (res.own?.labels ?? {}) : (section?.labels ?? {})
  lines.push('tags:')
  if (!tags.length) lines.push('  —')
  for (const t of tags) {
    lines.push(own ? `  #${t}` : `  #${t.value}`)
  }
  lines.push('labels:')
  const entries = Object.entries(labels)
  if (!entries.length) lines.push('  —')
  for (const [k, v] of entries) {
    lines.push(own ? `  ${k}=${v}` : `  ${k}=${v.value}`)
  }
  return lines.join('\n')
}

const query = (type, id, extra = '', scope) =>
  `/auth/meta?${new URLSearchParams({ type, id, ...(scope ? { scope: scope.kind, revision: scope.id } : {}) })}${extra}`

/**
 * @param {string[]} argv args after `meta`
 * @param {{ auth: (flags: object) => { remote: string, token: string },
 *           ctx: (flags: object) => { namespace: string, repo: string, branch?: string },
 *           usage: (code?: number) => never }} deps
 */
export async function cmdMeta(argv, deps) {
  const [sub, ...rest] = argv
  if (!sub || sub === '-h' || sub === '--help') deps.usage(sub ? 0 : 1)
  if (!['get', 'set', 'clear'].includes(sub)) {
    console.error(`Unknown meta command: ${sub}`)
    deps.usage(1)
  }
  let p
  try {
    p = parseMetaArgs(rest)
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    deps.usage(1)
  }
  const [type, idArg] = p._
  if (!type) {
    console.error(`Usage: mice meta ${sub} <type> [id]`)
    deps.usage(1)
  }

  let id
  try {
    id = resolveEntityId(type, idArg, () => deps.ctx(p.flags))
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
    return
  }
  const { remote, token } = deps.auth(p.flags)

  try {
    const pathEntity = type === 'file' || type === 'directory'
    let scope
    if (pathEntity) {
      if (!['repository', 'branch', 'commit'].includes(p.flags.scope)) throw new Error('Path metadata requires --scope repository|branch|commit')
      if (p.flags.scope !== 'repository') {
        if (!p.flags.revision) throw new Error('Branch/commit scope requires --revision <name-or-id>')
        scope = { kind: p.flags.scope, id: p.flags.revision }
      } else if (p.flags.revision) throw new Error('--revision requires branch or commit scope')
    } else if (p.flags.scope || p.flags.revision) throw new Error('--scope and --revision apply only to files and directories')
    const ref = { type, id, ...(scope ? { scope } : {}) }
    if (sub === 'get') {
      const res = await api(remote, token, query(type, id, p.flags.own ? '&view=own' : '', scope))
      console.log(p.flags.json ? JSON.stringify(res, null, 2) : formatMeta(res, !!p.flags.own))
      return
    }

    if (sub === 'set') {
      const patch = buildPatch(p)
      if (!Object.keys(patch).length && !p.untags.length) {
        console.error('Nothing to change. Use --tag, --label, --untag or --unlabel.')
        process.exitCode = 1
        return
      }
      const current = await api(remote, token, query(type, id, '', scope))
      const own = current.own
      if (patch.tags || p.untags.length) {
        patch.tags = [...new Set([...(own?.tags ?? []), ...(patch.tags ?? [])])].filter(t => !p.untags.includes(t))
      }
      const res = await api(remote, token, '/auth/meta', {
        method: 'PUT',
        body: JSON.stringify({ ref, ...patch, ifRevision: current.revision, ifVersion: current.version }),
      })
      if (p.flags.json) console.log(JSON.stringify(res, null, 2))
      else {
        console.log(`Updated ${type} ${id}`)
      }
      return
    }

    if (!p.flags.yes && process.env.MICE_YES !== '1') {
      console.error(`This removes all tags and labels from ${type} ${id}. Re-run with --yes to confirm.`)
      process.exitCode = 1
      return
    }
    const current = await api(remote, token, query(type, id, '', scope))
    const version = current.version ? `&ifVersion=${encodeURIComponent(current.version)}` : ''
    const res = await api(remote, token, query(type, id, `&ifRevision=${current.revision}${version}`, scope), { method: 'DELETE' })
    console.log(res.removed ? `Cleared metadata on ${type} ${id}` : `No metadata on ${type} ${id}`)
  } catch (err) {
    console.error(`mice: ${err instanceof Error ? err.message : err}`)
    process.exitCode = 1
  }
}

/**
 * Pull creation-time `--tag` / `--label` options out of argv (stopping at `--`).
 * Returns the remaining args and a validated patch (or null when none given).
 * @param {string[]} argv
 */
export function extractCreateMeta(argv) {
  const rest = []
  const p = { _: [], tags: [], untags: [], labels: [], unlabels: [], flags: {} }
  let i = 0
  for (; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--') break
    const eq = a.indexOf('=')
    const key = a.startsWith('--') ? (eq > 2 ? a.slice(2, eq) : a.slice(2)) : ''
    if (key !== 'tag' && key !== 'label') {
      rest.push(a)
      continue
    }
    const value = eq > 2 ? a.slice(eq + 1) : argv[++i]
    if (value == null) throw new Error(`Missing value for --${key}`)
    if (key === 'tag') p.tags.push(...splitList(value))
    else p.labels.push(value)
  }
  rest.push(...argv.slice(i))
  const patch = buildPatch(p)
  return { args: rest, patch: Object.keys(patch).length ? patch : null }
}

/**
 * Which entity does this oxen command create? Only commands that create one
 * accept --tag/--label.
 * @param {string[]} args oxen argv without meta flags
 * @returns {{ kind: 'commit' | 'branch' | 'repo', name?: string } | null}
 */
export function detectCreation(args) {
  const [cmd, ...rest] = args
  const pos = rest.filter((a) => !a.startsWith('-'))
  if (cmd === 'commit') return { kind: 'commit' }
  if (cmd === 'branch') {
    const flagged = rest.some((a) =>
      ['-d', '-D', '--delete', '-m', '--move', '--all', '-a', '--remote', '-r', '--show-current', '--list'].includes(a),
    )
    return pos[0] && !flagged ? { kind: 'branch', name: pos[0] } : null
  }
  if (cmd === 'checkout') {
    const i = rest.findIndex((a) => a === '-b' || a === '-B')
    return i >= 0 && rest[i + 1] ? { kind: 'branch', name: rest[i + 1] } : null
  }
  if (cmd === 'create-remote') {
    const i = rest.findIndex((a) => a === '-n' || a === '--name')
    const name = i >= 0 ? rest[i + 1] : pos.find((a) => /^[^/\s]+\/[^/\s]+$/.test(a))
    return name && /^[^/\s]+\/[^/\s]+$/.test(name) ? { kind: 'repo', name } : null
  }
  return null
}

/**
 * Apply a creation-time patch. Failures warn instead of failing the command
 * that already succeeded.
 */
export async function applyCreateMeta({ remote, token, type, id, patch }) {
  try {
    const current = await api(remote, token, query(type, id))
    await api(remote, token, '/auth/meta', {
      method: 'PUT',
      body: JSON.stringify({ ref: { type, id }, ...patch, ifRevision: current.revision, ifVersion: current.version }),
    })
    console.error(`mice: metadata set on ${type} ${id}`)
    return true
  } catch (err) {
    console.error(
      `mice: could not set metadata on ${type} ${id}: ${err instanceof Error ? err.message : err}\n` +
        `      retry with: mice meta set ${type} ${id} …`,
    )
    return false
  }
}
