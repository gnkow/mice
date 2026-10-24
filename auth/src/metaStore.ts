import { join } from 'node:path'
import type { AuditActor } from './audit.js'
import { env } from './env.js'
import { createDocumentStore, createJsonlLog } from './stores.js'
import {
  LIMITS,
  MetaError,
  assertKey,
  assertTag,
  assertValue,
  normalizeKey,
  normalizeTag,
  refKey,
  type EntityRef,
  type MetaPatch,
  type MetaRecord,
} from './metaTypes.js'

type StoreFile = { records: Record<string, MetaRecord>; revisions: Record<string, number>; history: MetaRevision[] }

export type MetaRevision = {
  key: string
  ref: EntityRef
  revision: number
  ts: string
  actor: AuditActor
  op: 'set' | 'delete'
  before: MetaRecord | null
  after: MetaRecord | null
}

function storePath(): string {
  return join(env.dataDir, 'meta.json')
}

function historyPath(): string {
  return join(env.dataDir, 'meta-history.jsonl')
}

const store = createDocumentStore<StoreFile>({
  path: storePath,
  initial: () => ({ records: {}, revisions: {}, history: [] }),
  validate(f) {
    if (!f.records || typeof f.records !== 'object' || Array.isArray(f.records)) throw new Error('Invalid metadata store')
  },
  migrate(f) {
    const records: StoreFile['records'] = {}
    const revisions = { ...(f.revisions ?? {}) }
    for (const [key, record] of Object.entries(f.records)) {
      const clean = explicitRecord(record)
      if (!isEmpty(clean)) records[key] = clean
      revisions[key] ??= record.revision
    }
    f.records = records
    f.revisions = revisions
    f.history ??= []
  },
})

const historyLog = createJsonlLog<MetaRevision>(historyPath)

const read = (): StoreFile => store.read()

/** Persists the explicit-only metadata migration; reads apply it in memory and never write. */
export function migrateMetaStore(): boolean {
  return store.migrate()
}

function explicitRecord(record: MetaRecord): MetaRecord {
  return {
    ref: record.ref, revision: record.revision, tags: record.tags, labels: record.labels,
    createdAt: record.createdAt, updatedAt: record.updatedAt, updatedBy: record.updatedBy,
  }
}

export function getOwnRecord(ref: EntityRef): MetaRecord | null {
  return read().records[refKey(ref)] ?? null
}

export function listOwnRecords(): MetaRecord[] {
  return Object.values(read().records)
}

export function getRevision(ref: EntityRef): number {
  const f = read()
  return f.revisions[refKey(ref)] ?? f.records[refKey(ref)]?.revision ?? 0
}

export function listHistory(ref: EntityRef): MetaRevision[] {
  const key = refKey(ref)
  const out: MetaRevision[] = []
  for (const rev of historyLog.readAll()) if (rev.key === key) out.push(rev)
  out.push(...read().history.filter((rev) => rev.key === key))
  return out.reverse()
}

function uniq(list: string[]): string[] {
  return [...new Set(list)]
}

function isEmpty(r: MetaRecord): boolean {
  return (
    r.tags.length === 0 &&
    Object.keys(r.labels).length === 0
  )
}

/**
 * Merge `patch` into the entity's own record.
 *  - `tags` replaces the previous list when provided.
 *  - `labels` merge per key; a `null` value deletes that key.
 */
export function buildRecord(
  ref: EntityRef,
  prev: MetaRecord | null,
  patch: MetaPatch,
  actor: AuditActor,
  now = new Date().toISOString(),
): MetaRecord {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new MetaError(422, 'Metadata patch must be an object')
  for (const field of ['inherit', 'propagation', 'removeTags', 'unset']) {
    if (Object.hasOwn(patch, field)) throw new MetaError(422, `${field} is no longer supported; metadata is explicit-only`)
  }
  for (const field of ['tags'] as const) {
    if (patch[field] !== undefined && (!Array.isArray(patch[field]) || patch[field].some((v) => typeof v !== 'string'))) throw new MetaError(422, `${field} must be a list of strings`)
  }
  if (patch.labels !== undefined && (!patch.labels || typeof patch.labels !== 'object' || Array.isArray(patch.labels))) throw new MetaError(422, 'labels must be an object')
  const next: MetaRecord = {
    ref,
    revision: (prev?.revision ?? 0) + 1,
    tags: [...(prev?.tags ?? [])],
    labels: { ...(prev?.labels ?? {}) },
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
    updatedBy: actor,
  }

  if (patch.tags) {
    next.tags = uniq(patch.tags.map(normalizeTag).filter(Boolean))
    next.tags.forEach(assertTag)
  }
  for (const [k0, v] of Object.entries(patch.labels ?? {})) {
    const k = normalizeKey(k0)
    assertKey(k, 'label')
    if (v === null) delete next.labels[k]
    else {
      Object.defineProperty(next.labels, k, { value: assertValue(v, `label "${k}"`), enumerable: true, writable: true, configurable: true })
    }
  }
  if (next.tags.length > LIMITS.tags) throw new MetaError(422, `Too many tags (max ${LIMITS.tags})`)
  if (Object.keys(next.labels).length > LIMITS.labels) {
    throw new MetaError(422, `Too many labels (max ${LIMITS.labels})`)
  }
  if (Buffer.byteLength(JSON.stringify(next), 'utf8') > LIMITS.record) {
    throw new MetaError(422, `Metadata record too large (max ${LIMITS.record} bytes)`)
  }
  return next
}

/** Apply a patch with optimistic concurrency; returns the new own record (null when it became empty). */
export function putOwnRecord(
  ref: EntityRef,
  patch: MetaPatch,
  actor: AuditActor,
  ifRevision?: number,
): { before: MetaRecord | null; after: MetaRecord | null } {
  return store.transaction((file) => {
    const key = refKey(ref)
    const prev = file.records[key] ?? null
    const revision = file.revisions[key] ?? prev?.revision ?? 0
    if (ifRevision !== undefined && revision !== ifRevision) {
      throw new MetaError(
        409,
        `Revision conflict: expected ${ifRevision}, current ${revision}`,
      )
    }
    const built = buildRecord(ref, prev, patch, actor)
    built.revision = revision + 1
    const after = isEmpty(built) ? null : built
    if (after) file.records[key] = after
    else delete file.records[key]
    file.revisions[key] = built.revision
    file.history.push({
      key,
      ref,
      revision: built.revision,
      ts: built.updatedAt,
      actor,
      op: after ? 'set' : 'delete',
      before: prev,
      after,
  })
  return { before: prev, after }
  })
}

export function deleteOwnRecord(
  ref: EntityRef,
  actor: AuditActor,
  ifRevision?: number,
): { before: MetaRecord | null } {
  const key = refKey(ref)
  const current = read()
  const currentRevision = current.revisions[key] ?? current.records[key]?.revision ?? 0
  if (ifRevision !== undefined && currentRevision !== ifRevision) throw new MetaError(409, `Revision conflict: expected ${ifRevision}, current ${currentRevision}`)
  if (!current.records[key]) return { before: null }
  return store.transaction((file) => {
    const prev = file.records[key]!
    const revision = file.revisions[key] ?? prev.revision
    delete file.records[key]
    file.revisions[key] = revision + 1
    file.history.push({
      key,
      ref,
      revision: revision + 1,
      ts: new Date().toISOString(),
      actor,
      op: 'delete',
      before: prev,
      after: null,
  })
  return { before: prev }
  })
}
