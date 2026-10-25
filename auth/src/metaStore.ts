import { desc, eq } from 'drizzle-orm'
import type { AuditActor } from './audit.js'
import { getDb } from './db/database.js'
import { metaHistory, metaRecords, metaRevisions } from './db/schema.js'
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

export async function getOwnRecord(ref: EntityRef): Promise<MetaRecord | null> {
  const [row] = await getDb().select().from(metaRecords).where(eq(metaRecords.key, refKey(ref)))
  return row?.body ?? null
}

export async function listOwnRecords(): Promise<MetaRecord[]> {
  return (await getDb().select().from(metaRecords)).map((r) => r.body)
}

export async function getRevision(ref: EntityRef): Promise<number> {
  const [row] = await getDb().select().from(metaRevisions).where(eq(metaRevisions.key, refKey(ref)))
  return row?.value ?? 0
}

/** Newest first; reads only this entity's revisions. */
export async function listHistory(ref: EntityRef): Promise<MetaRevision[]> {
  const rows = await getDb().select().from(metaHistory).where(eq(metaHistory.key, refKey(ref))).orderBy(desc(metaHistory.revision))
  return rows.map((r) => r.body)
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

/**
 * Runs `change` against the entity's current record with its revision row locked, so concurrent
 * edits serialise and a stale `ifRevision` is rejected.
 */
async function withLockedEntity<T>(
  key: string,
  ifRevision: number | undefined,
  change: (prev: MetaRecord | null, revision: number, tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0]) => Promise<T>,
): Promise<T> {
  return getDb().transaction(async (tx) => {
    await tx.insert(metaRevisions).values({ key, value: 0 }).onConflictDoNothing()
    const [counter] = await tx.select().from(metaRevisions).where(eq(metaRevisions.key, key)).for('update')
    const revision = counter!.value
    if (ifRevision !== undefined && revision !== ifRevision) {
      throw new MetaError(409, `Revision conflict: expected ${ifRevision}, current ${revision}`)
    }
    const [row] = await tx.select().from(metaRecords).where(eq(metaRecords.key, key))
    return change(row?.body ?? null, revision, tx)
  })
}

async function recordRevision(
  tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
  rev: MetaRevision,
): Promise<void> {
  await tx.update(metaRevisions).set({ value: rev.revision }).where(eq(metaRevisions.key, rev.key))
  await tx.insert(metaHistory).values({ key: rev.key, revision: rev.revision, body: rev })
}

/** Apply a patch with optimistic concurrency; returns the new own record (null when it became empty). */
export async function putOwnRecord(
  ref: EntityRef,
  patch: MetaPatch,
  actor: AuditActor,
  ifRevision?: number,
): Promise<{ before: MetaRecord | null; after: MetaRecord | null }> {
  const key = refKey(ref)
  return withLockedEntity(key, ifRevision, async (prev, revision, tx) => {
    const built = buildRecord(ref, prev, patch, actor)
    built.revision = revision + 1
    const after = isEmpty(built) ? null : built
    if (after) {
      await tx.insert(metaRecords).values({ key, body: after }).onConflictDoUpdate({ target: metaRecords.key, set: { body: after } })
    } else {
      await tx.delete(metaRecords).where(eq(metaRecords.key, key))
    }
    await recordRevision(tx, { key, ref, revision: built.revision, ts: built.updatedAt, actor, op: after ? 'set' : 'delete', before: prev, after })
    return { before: prev, after }
  })
}

export async function deleteOwnRecord(
  ref: EntityRef,
  actor: AuditActor,
  ifRevision?: number,
): Promise<{ before: MetaRecord | null }> {
  const key = refKey(ref)
  return withLockedEntity(key, ifRevision, async (prev, revision, tx) => {
    if (!prev) return { before: null }
    await tx.delete(metaRecords).where(eq(metaRecords.key, key))
    await recordRevision(tx, { key, ref, revision: revision + 1, ts: new Date().toISOString(), actor, op: 'delete', before: prev, after: null })
    return { before: prev }
  })
}
