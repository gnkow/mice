import type { AuditActor } from './audit.js'

export const ENTITY_TYPES = [
  'namespace',
  'repo',
  'branch',
  'commit',
  'directory',
  'file',
  'workspace',
  'job',
  'session',
] as const
export type EntityType = (typeof ENTITY_TYPES)[number]

export type EntityRef = {
  type: EntityType
  id: string
  namespace?: string
  repo?: string
  scope?: { kind: 'branch' | 'commit'; id: string }
}

export type MetaValue = string

export type MetaRecord = {
  ref: EntityRef
  revision: number
  tags: string[]
  labels: Record<string, string>
  createdAt: string
  updatedAt: string
  updatedBy: AuditActor
}

export type MetaPatch = {
  tags?: string[]
  labels?: Record<string, string | null>
}

export const LIMITS = {
  tags: 50,
  labels: 100,
  value: 2 * 1024,
  key: 64,
  record: 64 * 1024,
} as const

export class MetaError extends Error {
  constructor(
    public status: 400 | 403 | 404 | 409 | 422,
    message: string,
  ) {
    super(message)
  }
}

const KEY_RE = /^[a-z0-9][a-z0-9_.\-/]*$/
const TAG_RE = /^[a-z0-9][a-z0-9_.\-/:]*$/

export function normalizeTag(raw: string): string {
  return raw.trim().toLowerCase()
}

export function normalizeKey(raw: string): string {
  return raw.trim().toLowerCase()
}

export function assertKey(key: string, what: string): void {
  if (key.length > LIMITS.key || !KEY_RE.test(key)) {
    throw new MetaError(
      422,
      `Invalid ${what} key "${key}" (lowercase letters, digits, _ . - /; max ${LIMITS.key})`,
    )
  }
}

export function assertTag(tag: string): void {
  if (tag.length > LIMITS.key || !TAG_RE.test(tag)) {
    throw new MetaError(
      422,
      `Invalid tag "${tag}" (lowercase letters, digits, _ . - / :; max ${LIMITS.key})`,
    )
  }
}

export function assertValue(v: unknown, what: string): MetaValue {
  if (typeof v !== 'string') throw new MetaError(422, `${what} must be a string`)
  if (v.length > LIMITS.value) {
    throw new MetaError(422, `${what} value too long (max ${LIMITS.value})`)
  }
  return v
}

/* ---------------- EntityRef ---------------- */

const REPO_RE = /^([^/@#:!\s]+)\/([^/@#:!\s]+)(?:([@#:!])(.+))?$/

export function formatRef(ref: EntityRef): string {
  return ref.scope
    ? `scoped:${JSON.stringify([ref.type, ref.id, ref.scope.kind, ref.scope.id])}`
    : `${ref.type}:${ref.id}`
}

export function refKey(ref: EntityRef): string {
  return formatRef(ref)
}

/** Parse `type` + `id` into a normalized ref (namespace/repo denormalised where derivable). */
export function parseRef(type: string, id: string, scope?: EntityRef['scope']): EntityRef {
  if (typeof type !== 'string' || typeof id !== 'string') throw new MetaError(400, 'Entity type and id must be strings')
  if (scope) {
    if (!['file', 'directory'].includes(type) || !['branch', 'commit'].includes(scope.kind) || typeof scope.id !== 'string' || !scope.id.trim()) {
      throw new MetaError(400, 'Path scope must specify a branch or commit id')
    }
    scope = { kind: scope.kind, id: scope.id.trim() }
  }
  if (!(ENTITY_TYPES as readonly string[]).includes(type)) {
    throw new MetaError(400, `Unknown entity type "${type}"`)
  }
  const t = type as EntityType
  const clean = id.trim()
  if (!clean) throw new MetaError(400, 'Entity id is required')
  switch (t) {
    case 'namespace':
      if (/[/@#:!\s]/.test(clean)) throw new MetaError(400, 'Invalid namespace id')
      return { type: t, id: clean, namespace: clean }
    case 'repo': {
      const m = REPO_RE.exec(clean)
      if (!m || m[3]) throw new MetaError(400, 'Repo id must be <namespace>/<repo>')
      return { type: t, id: clean, namespace: m[1], repo: m[2] }
    }
    case 'branch':
    case 'commit':
    case 'workspace':
    case 'file':
    case 'directory': {
      const m = REPO_RE.exec(clean)
      const sep = { branch: '@', commit: '#', workspace: '!', file: ':', directory: ':' }[t]
      if (!m || m[3] !== sep || !m[4]) {
        throw new MetaError(400, `${t} id must look like <namespace>/<repo>${sep}<name>`)
      }
      if (t === 'directory' && !clean.endsWith('/')) {
        throw new MetaError(400, 'Directory id must end with "/"')
      }
      if (t === 'file' && clean.endsWith('/')) {
        throw new MetaError(400, 'File id must not end with "/"')
      }
      if ((t === 'file' || t === 'directory') && (m[4].startsWith('/') || m[4].split('/').some((p) => p === '.' || p === '..' || p === '' && !clean.endsWith('/')) || m[4].includes('//'))) {
        throw new MetaError(400, 'Path must be relative and canonical')
      }
      return { type: t, id: clean, namespace: m[1], repo: m[2], ...(scope ? { scope } : {}) }
    }
    case 'job':
    case 'session':
      if (/[\s/]/.test(clean)) throw new MetaError(400, `Invalid ${t} id`)
      return { type: t, id: clean }
  }
}

function pathOf(ref: EntityRef): string {
  return ref.id.slice(ref.id.indexOf(':') + 1)
}

/** Fill namespace/repo on job refs for audit scoping and authorization. */
export function withRepoScope(
  ref: EntityRef,
  scope: { namespace: string; repo: string } | null,
): EntityRef {
  return scope ? { ...ref, namespace: scope.namespace, repo: scope.repo } : ref
}

/** Display label for a ref (last path segment / name). */
export function refLabel(ref: EntityRef): string {
  switch (ref.type) {
    case 'file':
    case 'directory':
      return pathOf(ref)
    case 'branch':
    case 'commit':
    case 'workspace':
      return ref.id.slice(ref.id.search(/[@#!]/) + 1)
    default:
      return ref.id
  }
}

/** UI route to the source entity's metadata view, optionally focusing one item. */
export function metaUrl(ref: EntityRef, focus?: string): string {
  const p = new URLSearchParams({ type: ref.type, id: ref.id })
  if (ref.scope) {
    p.set('scope', ref.scope.kind)
    p.set('revision', ref.scope.id)
  }
  if (focus) p.set('focus', focus)
  return `/meta?${p.toString()}`
}
