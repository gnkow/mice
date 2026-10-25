import { writeFileSync } from 'node:fs'
import { api } from './api.mjs'
import { confirmOrExit } from './confirm.mjs'
import { reasonHeaders } from './reason.mjs'
import {
  INSTANCE_PERMISSIONS,
  NAMESPACE_CAPABILITIES,
  REPO_FINE_PERMISSIONS,
  REPO_ROLES,
} from './authzContract.mjs'
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
  'workspace',
  'notifications',
  'favorite',
  'announcement',
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
const oneOf = (values, label) => (names) => {
  for (const n of names) if (!values.includes(n)) throw new UsageError(`Unknown ${label} "${n}"; expected one of ${values.join(', ')}`)
  return names
}
const instancePermissions = oneOf(INSTANCE_PERMISSIONS, 'instance permission')
const namespacePermissions = oneOf(NAMESPACE_CAPABILITIES, 'namespace permission')
const repoPermissions = oneOf(REPO_FINE_PERMISSIONS, 'repository permission')
const BASE_ROLES = REPO_ROLES.filter((r) => r !== 'admin')
const choice = (flag, value, values) => {
  if (!values.includes(value)) throw new UsageError(`--${flag} must be one of ${values.join(', ')}`)
  return value
}
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
        workspace_id: str(flags['stage-id']) ?? str(flags['workspace-id']),
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
          body: { ...userOnly(flags), permissions: instancePermissions(list(flags.permissions)) },
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
        if (flags.permissions !== undefined) {
          const names = list(flags.permissions)
          b.permissions = kind === 'namespace' ? namespacePermissions(names) : repoPermissions(names)
        }
        if (kind === 'namespace' && flags['base-repository-role']) {
          b.baseRepositoryRole = choice('base-repository-role', str(flags['base-repository-role']), ['none', ...REPO_ROLES])
        }
        if (kind === 'repo' && flags.base) b.base = choice('base', str(flags.base), BASE_ROLES)
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
      if (sub === 'list') {
        const q = qs({ all: flags.all ? '1' : undefined, workspace_id: str(flags.workspace) })
        return { method: 'GET', path: `/auth/sessions${q}` }
      }
      if (sub === 'create') {
        const body = {}
        if (flags.template) body.template_id = str(flags.template)
        if (flags.image) body.image = str(flags.image)
        const res = {}
        for (const k of ['cpu', 'memory', 'disk']) if (flags[k]) res[k] = str(flags[k])
        if (Object.keys(res).length) body.resources = res
        const mounts = [].concat(flags.mount ?? []).map((m) => parseMount(String(m)))
        for (const w of [].concat(flags.workspace ?? [])) mounts.push(parseWorkspaceMount(String(w)))
        for (const w of [].concat(flags['new-workspace'] ?? [])) mounts.push(parseNewWorkspace(String(w)))
        if (mounts.length) body.mounts = mounts
        if (flags.recording !== undefined) body.recording = bool(flags.recording, 'recording')
        return { method: 'POST', path: '/auth/sessions', body }
      }
      const id = enc(need(args[0], 'session id'))
      const base = `/auth/sessions/${id}`
      if (sub === 'show') return { method: 'GET', path: base }
      if (['connect', 'disconnect', 'retry', 'stop'].includes(sub)) return { method: 'POST', path: `${base}/${sub}` }
      if (sub === 'remount') {
        const body = {}
        if (flags.workspace) body.workspace_id = str(flags.workspace)
        if (flags['mount-path']) body.mount_path = str(flags['mount-path'])
        return { method: 'POST', path: `${base}/remount`, body }
      }
      if (sub === 'mounts') {
        const list = (k) => [].concat(flags[k] ?? []).map(String)
        const set = flags.set === undefined ? undefined : list('set').filter((x) => x !== 'none').map(parseMount)
        const add = [...list('add').map(parseMount), ...list('new-workspace').map(parseNewWorkspace)]
        const remove = list('remove').map((r) => {
          if (!/^w_[0-9a-z]+$/.test(r)) throw new UsageError(`Bad --remove ${r}; expected w_<id>`)
          return r
        })
        if (set === undefined && add.length === 0 && remove.length === 0) {
          throw new UsageError('mice session mounts <id> needs --set, --add, --remove or --new-workspace')
        }
        const edit = { add, remove }
        if (set !== undefined) return { method: 'PUT', path: `${base}/mounts`, body: { mounts: applyMountEdits(set, edit) } }
        return { method: 'PUT', path: `${base}/mounts`, mountsEdit: edit, fetchPath: base }
      }
      if (sub === 'destroy') {
        return { method: 'DELETE', path: base, confirm: `This destroys session ${args[0]}.` }
      }
      break
    }

    case 'workspace': {
      const base = '/auth/workspaces'
      if (!sub || sub === 'list') {
        let namespace
        let repo
        if (args[0]) ({ namespace, repo } = parseNsRepo(args[0]))
        return { method: 'GET', path: `${base}${qs({ namespace, repo })}` }
      }
      if (sub === 'create') {
        const { namespace, repo } = parseNsRepo(need(args[0], 'ns/repo'))
        if (flags.branch && flags.commit) throw new UsageError('Use only one of --branch / --commit')
        const source = flags.commit ? { commit: str(flags.commit) } : { branch: str(flags.branch) ?? 'main' }
        return { method: 'POST', path: base, body: { namespace, repo, name: str(flags.name), source } }
      }
      const id = need(args[0], 'workspace id')
      if (!WORKSPACE_ID_RE.test(id)) throw new UsageError(`Bad workspace id ${id}; expected w_<10 chars>`)
      const one = `${base}/${enc(id)}`
      if (sub === 'show') return { method: 'GET', path: one }
      if (sub === 'changes') return { method: 'GET', path: `${one}/changes` }
      if (sub === 'delete') return { method: 'DELETE', path: one, confirm: `This deletes workspace ${id} and its uncommitted changes.` }
      break
    }

    case 'announcement': {
      const base = '/auth/announcements'
      const severities = ['info', 'warning', 'critical']
      if (!sub || sub === 'list') return { method: 'GET', path: `${base}${qs({ all: flags.all ? '1' : undefined })}` }
      if (sub === 'create') {
        const severity = str(flags.severity)
        if (severity && !severities.includes(severity)) throw new UsageError(`--severity must be one of ${severities.join(', ')}`)
        return {
          method: 'POST',
          path: base,
          body: { title: need(str(flags.title), '--title'), message: str(flags.message), severity, expiresAt: str(flags.expires) },
        }
      }
      if (sub === 'enable' || sub === 'disable') {
        return { method: 'PATCH', path: `${base}/${enc(need(args[0], 'announcement id'))}`, body: { active: sub === 'enable' } }
      }
      if (sub === 'delete') return { method: 'DELETE', path: `${base}/${enc(need(args[0], 'announcement id'))}` }
      break
    }

    case 'favorite': {
      const base = '/auth/favorites'
      const types = ['namespace', 'repo', 'branch', 'stage', 'job', 'session']
      // `workspace` is a deprecated alias of `stage`.
      const canon = (t) => (t === 'workspace' ? 'stage' : t)
      if (!sub || sub === 'list') {
        const type = canon(str(flags.type))
        if (type && !types.includes(type)) throw new UsageError(`--type must be one of ${types.join(', ')}`)
        return { method: 'GET', path: `${base}${qs({ type })}` }
      }
      if (sub === 'add' || sub === 'remove') {
        const type = canon(need(args[0], `entity type (${types.join('|')})`))
        if (!types.includes(type)) throw new UsageError(`Unknown entity type "${type}". One of: ${types.join(', ')}`)
        let id
        try {
          // Stage ids share the `ns/repo!<id>` syntax of the meta `workspace` type.
          id = resolveEntityId(type === 'stage' ? 'workspace' : type, args[1], ctx)
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

/** Apply --remove then --add/--new-workspace to a desired mount list (an added id replaces its entry). */
export function applyMountEdits(current, { add = [], remove = [] }) {
  const drop = new Set(remove)
  const replaced = new Set(add.map((m) => m.workspace_id).filter(Boolean))
  return [
    ...current.filter((m) => !m.workspace_id || (!drop.has(m.workspace_id) && !replaced.has(m.workspace_id))),
    ...add,
  ]
}

/** `w_<id>[:ro|:rw]` → session mount input. Sessions mount workspaces only. */
export function parseMount(spec) {
  if (!/^w_/.test(spec)) {
    throw new UsageError(`Bad --mount ${spec}; sessions mount workspaces: use w_<id>[:ro|rw] (or --new-workspace ns/repo@branch)`)
  }
  return parseWorkspaceMount(spec)
}

/** `ns/repo@branch|#commit[=name][:ro|:rw]` → mount that creates a workspace on demand. */
export function parseNewWorkspace(spec) {
  const usage = `Bad --new-workspace ${spec}; use ns/repo@branch or ns/repo#commit, optional =name and :ro|rw`
  let rest = spec
  let mount_mode
  const mode = /:(ro|rw)$/.exec(rest)
  if (mode) {
    mount_mode = mode[1]
    rest = rest.slice(0, mode.index)
  }
  let name
  const eq = rest.indexOf('=')
  if (eq >= 0) {
    name = rest.slice(eq + 1)
    rest = rest.slice(0, eq)
    if (!name) throw new UsageError(usage)
  }
  const m = /^([^/\s@#]+)\/([^/\s@#]+)([@#])(\S+)$/.exec(rest)
  if (!m) throw new UsageError(usage)
  const [, namespace, repo, kind, ref] = m
  return {
    new_workspace: {
      namespace,
      repo,
      ...(name ? { name } : {}),
      source: kind === '@' ? { branch: ref } : { commit: ref },
    },
    ...(mount_mode ? { mount_mode } : {}),
  }
}

const WORKSPACE_ID_RE = /^w_[0-9a-z]{10}$/

function parseNsRepo(spec) {
  const m = /^([^/\s]+)\/([^/\s]+)$/.exec(spec)
  if (!m) throw new UsageError(`Bad repository ${spec}; use ns/repo`)
  return { namespace: m[1], repo: m[2] }
}

/** `w_<id>[:ro|:rw]` → session mount input backed by a Mice workspace. */
export function parseWorkspaceMount(spec) {
  const m = /^(w_[0-9a-z]{10})(?::(ro|rw))?$/.exec(spec)
  if (!m) throw new UsageError(`Bad workspace mount ${spec}; use w_<id>[:ro|rw]`)
  return { workspace_id: m[1], ...(m[2] ? { mount_mode: m[2] } : {}) }
}

function parseJsonFlag(v) {
  const raw = need(v, '--json <json>')
  try {
    return JSON.parse(raw)
  } catch {
    throw new UsageError('--json must be valid JSON')
  }
}

function printSessionNotes(res) {
  const sessions = res?.session ? [res.session] : []
  for (const s of sessions) {
    for (const m of s.mounts ?? []) {
      if (!m.workspace_id) {
        console.error(`mount ${m.mount_path}: legacy commit-pin mount (not mounted)`)
        continue
      }
      const eff = m.effective_mode ?? 'pending (workspace is being prepared; leased when ready)'
      console.error(`mount ${m.mount_path}: workspace ${m.workspace_id} requested ${m.mount_mode} -> effective ${eff}`)
    }
    for (const n of s.notices ?? []) console.error(`warning: ${n}`)
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
    if (req.mountsEdit) {
      const cur = await api(remote, token, req.fetchPath, { method: 'GET' })
      const now = (cur?.session?.mounts ?? [])
        .filter((m) => m.workspace_id)
        .map((m) => ({ workspace_id: m.workspace_id, mount_mode: m.mount_mode }))
      req.body = { mounts: applyMountEdits(now, req.mountsEdit) }
    }
    const res = await api(remote, token, req.path, {
      method: req.method,
      ...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {}),
      headers: reasonHeaders(req.method, str(flags.reason)),
    })
    if (req.text) {
      if (req.out) {
        writeFileSync(req.out, String(res))
        console.error(`Wrote ${req.out}`)
      } else process.stdout.write(String(res))
    } else console.log(JSON.stringify(res, null, 2))
    if (group === 'session') printSessionNotes(res)
  } catch (err) {
    console.error(`mice: ${err instanceof Error ? err.message : err}`)
    process.exitCode = 1
  }
}
