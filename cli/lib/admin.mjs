import { writeFileSync } from 'node:fs'
import { api } from './api.mjs'
import { confirmOrExit } from './confirm.mjs'
import { resolveEntityId } from './meta.mjs'

/**
 * Commands that mirror the BFF's /auth/* management API:
 *   authz, directory, access-request, training, audit, lineage, instance,
 *   namespace, collaborator, role, session, notifications, tokens-less admin.
 * Each command builds a plain request description (testable) that `runAdmin`
 * sends with the caller's PAT. Output is JSON unless stated otherwise.
 */

const BOOL_FLAGS = new Set(['yes', 'y', 'own', 'unread', 'all', 'keep-repos', 'revoke'])

export const ADMIN_GROUPS = [
  'authz',
  'directory',
  'access-request',
  'training',
  'audit',
  'lineage',
  'instance',
  'namespace',
  'collaborator',
  'role',
  'session',
  'notifications',
  'favorite',
]

/**
 * Parse argv into positionals and flags (`--k v`, `--k=v`, boolean flags).
 * Repeated flags collect into arrays.
 * @param {string[]} argv
 */
export function parseAdminArgs(argv) {
  const out = { _: [], flags: {} }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--') {
      out._.push(...argv.slice(i + 1))
      break
    }
    if (!a.startsWith('--')) {
      out._.push(a)
      continue
    }
    const eq = a.indexOf('=')
    const key = eq > 2 ? a.slice(2, eq) : a.slice(2)
    let value = true
    if (eq > 2) value = a.slice(eq + 1)
    else if (!BOOL_FLAGS.has(key) && argv[i + 1] != null && !argv[i + 1].startsWith('--')) {
      value = argv[++i]
    }
    const prev = out.flags[key]
    out.flags[key] = prev === undefined ? value : [].concat(prev, value)
  }
  return out
}

class UsageError extends Error {}

const need = (v, what) => {
  if (v == null || v === true || v === '') throw new UsageError(`Missing ${what}`)
  return String(v)
}
const str = (v) => (v == null || v === true || Array.isArray(v) ? undefined : String(v))
const list = (v) =>
  [].concat(v ?? [])
    .flatMap((x) => String(x).split(','))
    .map((x) => x.trim())
    .filter(Boolean)
const enc = encodeURIComponent
const qs = (params) => {
  const u = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    for (const x of [].concat(v ?? [])) if (x !== undefined && x !== true && x !== '') u.append(k, String(x))
  }
  const s = u.toString()
  return s ? `?${s}` : ''
}
const bool = (v, name) => {
  if (v === undefined) return undefined
  if (v === true || v === 'true' || v === 'on') return true
  if (v === 'false' || v === 'off') return false
  throw new UsageError(`--${name} must be true or false`)
}

/** `ns` or `ns/repo` positional, falling back to the clone context. */
function nsRepo(arg, flags, ctx, { repo = false } = {}) {
  let ns = str(flags.namespace)
  let rp = str(flags.repo)
  if (arg) {
    const [a, b] = String(arg).split('/')
    ns = ns || a
    rp = rp || b
  }
  if (!ns || (repo && !rp)) {
    const c = ctx()
    ns = ns || c.namespace
    rp = rp || c.repo
  }
  if (!ns) throw new UsageError('Need a namespace (ns or ns/repo, --namespace, or run inside a clone)')
  if (repo && !rp) throw new UsageError('Need a repository (ns/repo, --repo, or run inside a clone)')
  return { ns, repo: rp }
}

/** Member / collaborator / admin identity: `--group g` or `--sub s --iss i`. */
function principal(flags, { groupOk = true } = {}) {
  if (groupOk && flags.group) return { kind: 'group', group: need(flags.group, '--group') }
  return { kind: 'user', sub: need(flags.sub, '--sub'), iss: need(flags.iss, '--iss') }
}
const userOnly = (flags) => {
  const { sub, iss } = principal(flags, { groupOk: false })
  return { sub, iss }
}

/**
 * Translate `mice <group> <sub> …` into a request description.
 * @returns {{ method: string, path: string, body?: unknown,
 *   confirm?: string, text?: boolean, out?: string }}
 */
export function buildRequest(group, argv, ctx = () => ({})) {
  const { _: pos, flags } = parseAdminArgs(argv)
  const [sub, ...args] = pos

  switch (group) {
    case 'authz':
      return { method: 'GET', path: '/auth/me/authz' }

    case 'directory': {
      const q = pos[0] ?? ''
      const kind = str(flags.kind)
      if (kind && !['user', 'group'].includes(kind)) throw new UsageError('--kind must be user or group')
      return { method: 'GET', path: `/auth/directory/search${qs({ q, kind, limit: str(flags.limit) })}` }
    }

    case 'access-request': {
      if (sub === 'submit') {
        return { method: 'POST', path: '/auth/access-requests', body: { message: str(flags.message) ?? '' } }
      }
      if (sub === 'list') return { method: 'GET', path: '/auth/access-requests' }
      if (sub === 'approve' || sub === 'deny') {
        const id = need(args[0], 'request id')
        const body = { action: sub }
        if (sub === 'approve') {
          if (flags.permission) body.permission = str(flags.permission)
          else {
            body.namespace = need(flags.namespace, '--namespace (or --permission)')
            body.role = need(flags.role, '--role')
          }
        }
        return { method: 'POST', path: `/auth/access-requests/${enc(id)}`, body }
      }
      break
    }

    case 'training': {
      if (sub !== 'set') break
      const body = { completed: !flags.revoke }
      if (flags.sub || flags.iss) Object.assign(body, userOnly(flags))
      return { method: 'POST', path: '/auth/training', body }
    }

    case 'audit': {
      const filters = {
        actor: str(flags.actor),
        namespace: str(flags.namespace),
        repo: str(flags.repo),
        action: str(flags.action),
        since: str(flags.since),
        until: str(flags.until),
        session_id: str(flags['session-id']),
        workspace_id: str(flags['workspace-id']),
        job_id: str(flags['job-id']),
        via: str(flags.via),
      }
      if (filters.via && !['session', 'pat'].includes(filters.via)) throw new UsageError('--via must be session or pat')
      if (sub === 'list') {
        return {
          method: 'GET',
          path: `/auth/audit${qs({ ...filters, limit: str(flags.limit), cursor: str(flags.cursor) })}`,
        }
      }
      if (sub === 'facets') {
        return { method: 'GET', path: `/auth/audit/facets${qs({ namespace: filters.namespace })}` }
      }
      if (sub === 'export') {
        return { method: 'GET', path: `/auth/audit/export.csv${qs(filters)}`, text: true, out: str(flags.out) }
      }
      break
    }

    case 'lineage': {
      if (sub === 'query') {
        const { ns, repo } = nsRepo(undefined, flags, ctx, { repo: true })
        return {
          method: 'GET',
          path: `/auth/lineage${qs({
            namespace: ns,
            repo,
            path: str(flags.path),
            contentHash: str(flags['content-hash']),
            direction: str(flags.direction),
            depth: str(flags.depth),
            since: str(flags.since),
            until: str(flags.until),
            kind: str(flags.kind),
            jobId: str(flags['job-id']),
            commit: str(flags.commit),
            limit: str(flags.limit),
            cursor: str(flags.cursor),
          })}`,
        }
      }
      if (sub === 'rebuild') {
        const { ns, repo } = nsRepo(undefined, flags, ctx, { repo: true })
        return {
          method: 'POST',
          path: '/auth/lineage/rebuild',
          body: { namespace: ns, repo, path: need(flags.path, '--path'), branch: str(flags.branch) },
        }
      }
      break
    }

    case 'instance': {
      if (!sub || sub === 'show') return { method: 'GET', path: '/auth/instance' }
      if (sub === 'enforce') {
        const v = bool(args[0] === 'on' || args[0] === 'off' ? args[0] : undefined, 'enforce')
        if (v === undefined) throw new UsageError('Usage: mice instance enforce on|off')
        return { method: 'PATCH', path: '/auth/instance', body: { enforce: v } }
      }
      if (sub === 'admin') {
        const act = args[0]
        if (act === 'add') {
          return { method: 'POST', path: '/auth/instance/admins', body: userOnly(flags) }
        }
        if (act === 'remove') {
          return { method: 'DELETE', path: '/auth/instance/admins', body: userOnly(flags) }
        }
      }
      if (sub === 'permissions' && args[0] === 'set') {
        return {
          method: 'PUT',
          path: '/auth/instance/permissions',
          body: { ...userOnly(flags), permissions: list(flags.permissions) },
        }
      }
      break
    }

    case 'namespace': {
      if (sub === 'list') return { method: 'GET', path: '/auth/namespaces' }
      if (sub === 'show') return { method: 'GET', path: `/auth/namespaces/${enc(nsRepo(args[0], flags, ctx).ns)}` }
      if (sub === 'create') {
        const body = {
          name: need(args[0] ?? flags.name, 'namespace name'),
          basePermission: need(flags['base-permission'], '--base-permission'),
        }
        const m = bool(flags['members-create-repos'], 'members-create-repos')
        if (m !== undefined) body.membersCanCreateRepos = m
        return { method: 'POST', path: '/auth/namespaces', body }
      }
      if (sub === 'update') {
        const body = {}
        if (flags['base-permission']) body.basePermission = str(flags['base-permission'])
        const m = bool(flags['members-create-repos'], 'members-create-repos')
        if (m !== undefined) body.membersCanCreateRepos = m
        if (!Object.keys(body).length) throw new UsageError('Nothing to change: use --base-permission or --members-create-repos')
        return { method: 'PATCH', path: `/auth/namespaces/${enc(need(args[0], 'namespace'))}`, body }
      }
      if (sub === 'delete') {
        const ns = need(args[0], 'namespace')
        return {
          method: 'DELETE',
          path: `/auth/namespaces/${enc(ns)}`,
          body: { deleteRepositories: !flags['keep-repos'] },
          confirm: `This deletes namespace ${ns}${flags['keep-repos'] ? '' : ' and ALL its repositories'}.`,
        }
      }
      if (sub === 'member') {
        const act = args[0]
        const ns = enc(need(args[1], 'namespace'))
        if (act === 'set') {
          return {
            method: 'PUT',
            path: `/auth/namespaces/${ns}/members`,
            body: { ...principal(flags), role: need(flags.role, '--role') },
          }
        }
        if (act === 'remove') {
          return { method: 'DELETE', path: `/auth/namespaces/${ns}/members`, body: principal(flags) }
        }
      }
      break
    }

    case 'collaborator': {
      if (!['list', 'set', 'remove'].includes(sub)) break
      const { ns, repo } = nsRepo(args[0], flags, ctx, { repo: true })
      const path = `/auth/namespaces/${enc(ns)}/repos/${enc(repo)}/collaborators`
      if (sub === 'list') return { method: 'GET', path }
      if (sub === 'set') {
        return { method: 'PUT', path, body: { ...principal(flags), role: need(flags.role, '--role') } }
      }
      return { method: 'DELETE', path, body: principal(flags) }
    }

    case 'role': {
      // mice role <permissions|list|create|update|delete> <ns> [namespace|repo] …
      if (!['permissions', 'list', 'create', 'update', 'delete'].includes(sub)) break
      const ns = enc(nsRepo(args[0], flags, ctx).ns)
      const root = `/auth/namespaces/${ns}/custom-roles`
      if (sub === 'permissions') return { method: 'GET', path: `${root}/permissions` }
      if (sub === 'list') return { method: 'GET', path: root }
      const kind = args[1]
      if (kind !== 'namespace' && kind !== 'repo') throw new UsageError(`Usage: mice role ${sub} <ns> namespace|repo …`)
      const roleBody = () => {
        const b = {}
        if (flags.name) b.name = str(flags.name)
        if (flags.description !== undefined) b.description = str(flags.description) ?? ''
        if (flags.permissions !== undefined) b.permissions = list(flags.permissions)
        if (kind === 'namespace' && flags['base-repository-role']) {
          b.baseRepositoryRole = str(flags['base-repository-role'])
        }
        if (kind === 'repo' && flags.base) b.base = str(flags.base)
        return b
      }
      if (sub === 'create') {
        const b = roleBody()
        need(b.name, '--name')
        if (!b.permissions) throw new UsageError('Missing --permissions')
        if (kind === 'repo') need(b.base, '--base')
        return { method: 'POST', path: `${root}/${kind}`, body: b }
      }
      const roleId = enc(need(args[2], 'role id'))
      if (sub === 'update') {
        const b = roleBody()
        if (!Object.keys(b).length) throw new UsageError('Nothing to change')
        return { method: 'PATCH', path: `${root}/${kind}/${roleId}`, body: b }
      }
      return {
        method: 'DELETE',
        path: `${root}/${kind}/${roleId}`,
        confirm: `This deletes ${kind} role ${args[2]} in ${args[0]}.`,
      }
    }

    case 'session': {
      if (sub === 'templates') return { method: 'GET', path: '/auth/sessions/templates' }
      if (sub === 'retention') return { method: 'GET', path: '/auth/sessions/retention' }
      if (sub === 'list') return { method: 'GET', path: `/auth/sessions${flags.all ? '?all=1' : ''}` }
      if (sub === 'create') {
        const body = {}
        if (flags.template) body.template_id = str(flags.template)
        if (flags.image) body.image = str(flags.image)
        const res = {}
        for (const k of ['cpu', 'memory', 'disk']) if (flags[k]) res[k] = str(flags[k])
        if (Object.keys(res).length) body.resources = res
        const mounts = [].concat(flags.mount ?? []).map((m) => parseMount(String(m)))
        if (mounts.length) body.mounts = mounts
        if (flags.recording !== undefined) body.recording = bool(flags.recording, 'recording')
        return { method: 'POST', path: '/auth/sessions', body }
      }
      const id = enc(need(args[0], 'session id'))
      const base = `/auth/sessions/${id}`
      if (sub === 'show') return { method: 'GET', path: base }
      if (['connect', 'disconnect', 'retry', 'stop'].includes(sub)) return { method: 'POST', path: `${base}/${sub}` }
      if (sub === 'destroy') {
        return { method: 'DELETE', path: base, confirm: `This destroys session ${args[0]}.` }
      }
      if (sub === 'diff') return { method: 'GET', path: `${base}/mounts/${enc(need(args[1], 'mount key'))}/diff` }
      if (sub === 'sync') {
        const files = list(flags.file)
        return {
          method: 'POST',
          path: `${base}/sync/${enc(need(args[1], 'mount key'))}`,
          body: files.length ? { files } : {},
        }
      }
      break
    }

    case 'favorite': {
      const base = '/auth/favorites'
      const types = ['namespace', 'repo', 'branch', 'workspace', 'job', 'session']
      if (!sub || sub === 'list') {
        const type = str(flags.type)
        if (type && !types.includes(type)) throw new UsageError(`--type must be one of ${types.join(', ')}`)
        return { method: 'GET', path: `${base}${qs({ type })}` }
      }
      if (sub === 'add' || sub === 'remove') {
        const type = need(args[0], `entity type (${types.join('|')})`)
        if (!types.includes(type)) throw new UsageError(`Unknown entity type "${type}". One of: ${types.join(', ')}`)
        let id
        try {
          id = resolveEntityId(type, args[1], ctx)
        } catch (err) {
          throw new UsageError(err instanceof Error ? err.message : String(err))
        }
        return sub === 'add'
          ? { method: 'PUT', path: base, body: { type, id } }
          : { method: 'DELETE', path: `${base}${qs({ type, id })}` }
      }
      break
    }

    case 'notifications': {
      const base = '/auth/notifications'
      if (!sub || sub === 'list') {
        return { method: 'GET', path: `${base}${qs({ unread: flags.unread ? '1' : undefined, cursor: str(flags.cursor) })}` }
      }
      if (sub === 'unread-count') return { method: 'GET', path: `${base}/unread-count` }
      if (sub === 'read' || sub === 'unread') {
        return {
          method: 'PATCH',
          path: `${base}/${enc(need(args[0], 'notification id'))}`,
          body: { read: sub === 'read' },
        }
      }
      if (sub === 'read-all') {
        return { method: 'POST', path: `${base}/read-all`, body: { before: str(flags.before) ?? new Date().toISOString() } }
      }
      if (sub === 'preferences') {
        if (args[0] === 'set') {
          return { method: 'PATCH', path: `${base}/preferences`, body: parseJsonFlag(flags.json) }
        }
        return { method: 'GET', path: `${base}/preferences` }
      }
      if (sub === 'resource-overrides') return { method: 'GET', path: `${base}/resource-overrides` }
      if (sub === 'announce') {
        return {
          method: 'POST',
          path: `${base}/announcements`,
          body: { title: need(flags.title, '--title'), summary: need(flags.summary, '--summary') },
        }
      }
      break
    }
  }
  throw new UsageError(`Unknown or incomplete command: mice ${group}${sub ? ` ${sub}` : ''}`)
}

/** `ns/repo[@workspaceId][#commit][:ro|:rw]` → session mount input. */
export function parseMount(spec) {
  const m = /^([^/\s]+)\/([^/@#:\s]+)(?:@([^#:\s]+))?(?:#([^:\s]+))?(?::(ro|rw))?$/.exec(spec)
  if (!m) throw new UsageError(`Bad --mount ${spec}; use ns/repo[@workspace][#commit][:ro|rw]`)
  const [, namespace, repo, workspace_id, pin_commit, mount_mode] = m
  return {
    namespace,
    repo,
    ...(workspace_id ? { workspace_id } : {}),
    ...(pin_commit ? { pin_commit } : {}),
    ...(mount_mode ? { mount_mode } : {}),
  }
}

function parseJsonFlag(v) {
  const raw = need(v, '--json <json>')
  try {
    return JSON.parse(raw)
  } catch {
    throw new UsageError('--json must be valid JSON')
  }
}

/**
 * Run an admin command.
 * @param {string} group
 * @param {string[]} argv
 * @param {{ auth: (flags: object) => { remote: string, token: string },
 *           ctx: (flags: object) => object, usage: (code?: number) => never }} deps
 */
export async function runAdmin(group, argv, deps) {
  const { flags } = parseAdminArgs(argv)
  if (flags.help || flags.h) deps.usage(0)
  let req
  try {
    req = buildRequest(group, argv, () => deps.ctx(flags))
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    if (err instanceof UsageError) deps.usage(1)
    process.exitCode = 1
    return
  }
  const { remote, token } = deps.auth({ remote: str(flags.remote), token: str(flags.token) })
  try {
    if (req.confirm) await confirmOrExit(req.confirm, flags)
    const res = await api(remote, token, req.path, {
      method: req.method,
      ...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {}),
    })
    if (req.text) {
      if (req.out) {
        writeFileSync(req.out, String(res))
        console.error(`Wrote ${req.out}`)
      } else process.stdout.write(String(res))
    } else console.log(JSON.stringify(res, null, 2))
  } catch (err) {
    console.error(`mice: ${err instanceof Error ? err.message : err}`)
    process.exitCode = 1
  }
}
