import { and, desc, eq } from 'drizzle-orm'
import { getDb } from '../../../db/database.js'
import { commitQcEvents, commitQcStatus } from '../../../db/schema.js'
import { normalizePrincipalAuthorKey, signerAuthorKey } from '../../authentication/principal.js'

/** Branch-invariant QC disposition (ADR 0009). Missing row ≡ unset. */
export type CommitQc = 'unset' | 'valid' | 'invalid'

export type DispositionVerdict = 'valid' | 'invalid'

/** Signed map: commitId → Valid | Invalid. */
export type DispositionMap = Record<string, DispositionVerdict>

export type CommitQcRow = {
  repositoryId: string
  commitId: string
  status: CommitQc
  mergeRequestId: string | null
  signatureId: string | null
  updatedAt: Date
}

function toRow(r: typeof commitQcStatus.$inferSelect): CommitQcRow {
  return {
    repositoryId: r.repositoryId,
    commitId: r.commitId,
    status: normalizeStoredQc(r.status),
    mergeRequestId: r.mergeRequestId ?? null,
    signatureId: r.signatureId ?? null,
    updatedAt: r.updatedAt,
  }
}

/** Greenfield store should only see unset|valid|invalid; tolerate legacy rows if present. */
function normalizeStoredQc(raw: string): CommitQc {
  if (raw === 'valid' || raw === 'passed') return 'valid'
  if (raw === 'invalid' || raw === 'failed') return 'invalid'
  return 'unset'
}

/** Sentinel in client disposition maps before the merge commit id exists. */
export const MERGE_COMMIT_DISPOSITION_KEY = '__merge_commit__'

export function parseDispositionMap(raw: unknown): DispositionMap | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const out: DispositionMap = {}
  for (const [commitId, verdict] of Object.entries(raw as Record<string, unknown>)) {
    const id = commitId.trim()
    if (!id) return null
    if (verdict !== 'valid' && verdict !== 'invalid') return null
    out[id] = verdict
  }
  return out
}

/**
 * Peel `__merge_commit__` (or explicit mergeCommitDisposition) out of a client map.
 * Remaining entries are range commit dispositions only.
 */
export function splitMergeCommitDisposition(
  map: DispositionMap,
  explicit?: DispositionVerdict | null,
): { rangeMap: DispositionMap; mergeCommitDisposition: DispositionVerdict | undefined } {
  const rangeMap = { ...map }
  const fromSentinel = rangeMap[MERGE_COMMIT_DISPOSITION_KEY]
  delete rangeMap[MERGE_COMMIT_DISPOSITION_KEY]
  const mergeCommitDisposition =
    explicit === 'valid' || explicit === 'invalid'
      ? explicit
      : fromSentinel === 'valid' || fromSentinel === 'invalid'
        ? fromSentinel
        : undefined
  return { rangeMap, mergeCommitDisposition }
}

export async function getCommitQc(repositoryId: string, commitId: string): Promise<CommitQc> {
  const rows = await getDb()
    .select()
    .from(commitQcStatus)
    .where(
      and(eq(commitQcStatus.repositoryId, repositoryId), eq(commitQcStatus.commitId, commitId)),
    )
    .limit(1)
  if (!rows[0]) return 'unset'
  return normalizeStoredQc(rows[0].status)
}

export async function listCommitQcForRepo(repositoryId: string): Promise<CommitQcRow[]> {
  const rows = await getDb()
    .select()
    .from(commitQcStatus)
    .where(eq(commitQcStatus.repositoryId, repositoryId))
  return rows.map(toRow)
}

/** Commits covered by a disposition / merge / mark signature (for covering). */
export async function listCommitQcForSignature(signatureId: string): Promise<CommitQcRow[]> {
  const id = signatureId.trim()
  if (!id) return []
  const rows = await getDb()
    .select()
    .from(commitQcStatus)
    .where(eq(commitQcStatus.signatureId, id))
  return rows.map(toRow)
}

/**
 * Upsert QC status for many commits (branch-invariant).
 * Prefer {@link applyDispositionMap} for signed disposition ceremonies.
 */
export async function markCommitsQc(
  repositoryId: string,
  commitIds: string[],
  status: DispositionVerdict,
  opts?: {
    mergeRequestId?: string
    signatureId?: string
  },
): Promise<void> {
  const now = new Date()
  for (const commitId of commitIds) {
    const mergeRequestId =
      opts && 'mergeRequestId' in opts ? (opts.mergeRequestId ?? null) : undefined
    const signatureId =
      opts && 'signatureId' in opts ? (opts.signatureId ?? null) : undefined
    await getDb()
      .insert(commitQcStatus)
      .values({
        repositoryId,
        commitId,
        status,
        mergeRequestId: mergeRequestId ?? null,
        signatureId: signatureId ?? null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [commitQcStatus.repositoryId, commitQcStatus.commitId],
        set: {
          status,
          updatedAt: now,
          ...(mergeRequestId !== undefined ? { mergeRequestId } : {}),
          ...(signatureId !== undefined ? { signatureId } : {}),
        },
      })
  }
}

export type ApplyDispositionMapInput = {
  repositoryId: string
  map: DispositionMap
  signatureId: string
  actor: { iss: string; sub: string }
  /**
   * Author keys (`iss|sub`) per commit for the self-Valid rule.
   * Missing entry ⇒ treat as not authored by the actor.
   */
  authorsByCommitId?: Record<string, readonly string[]>
  mergeRequestId?: string
}

export type ApplyDispositionMapResult =
  | { ok: true; commitIds: string[] }
  | {
      ok: false
      status: number
      code: 'self_valid' | 'disposition_invalid' | 'signature_required'
      detail: string
      commitIds?: string[]
    }

/**
 * Apply a signed disposition map. Authors/co-authors may Invalid their own commits
 * but never Valid them (ADR 0009).
 */
export async function applyDispositionMap(
  input: ApplyDispositionMapInput,
): Promise<ApplyDispositionMapResult> {
  const signatureId = input.signatureId.trim()
  if (!signatureId) {
    return {
      ok: false,
      status: 400,
      code: 'signature_required',
      detail: 'An electronic signature is required to apply a disposition map',
    }
  }
  const entries = Object.entries(input.map)
  if (entries.length === 0) {
    return { ok: true, commitIds: [] }
  }

  const actorKey = signerAuthorKey(input.actor)
  const blocked: string[] = []
  for (const [commitId, verdict] of entries) {
    if (verdict !== 'valid') continue
    const authors = input.authorsByCommitId?.[commitId] ?? []
    const owns = authors.some((a) => normalizePrincipalAuthorKey(a) === actorKey)
    if (owns) blocked.push(commitId)
  }
  if (blocked.length > 0) {
    return {
      ok: false,
      status: 403,
      code: 'self_valid',
      detail: 'Cannot set Valid on commits you authored or co-authored',
      commitIds: blocked,
    }
  }

  const now = new Date()
  const commitIds: string[] = []
  for (const [commitId, verdict] of entries) {
    commitIds.push(commitId)
    await getDb()
      .insert(commitQcStatus)
      .values({
        repositoryId: input.repositoryId,
        commitId,
        status: verdict,
        mergeRequestId: input.mergeRequestId ?? null,
        signatureId,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [commitQcStatus.repositoryId, commitQcStatus.commitId],
        set: {
          status: verdict,
          updatedAt: now,
          signatureId,
          ...(input.mergeRequestId !== undefined
            ? { mergeRequestId: input.mergeRequestId }
            : {}),
        },
      })
    await getDb().insert(commitQcEvents).values({
      repositoryId: input.repositoryId,
      commitId,
      status: verdict,
      signatureId,
      actorKey,
      createdAt: now,
    })
  }
  return { ok: true, commitIds }
}

/**
 * Create-time empty-tip Valid (ADR 0009 carve-out).
 * Oxen requires a tip for named branches; Mice attributes that empty tip to the
 * creator. The create e-signature may Valid those parentless tips even though
 * the creator is the attributed author — this is scaffold QC, not self-approval
 * of work product. Requires a non-empty signatureId (the create ceremony).
 */
export async function applyBootstrapEmptyTipValid(input: {
  repositoryId: string
  commitIds: readonly string[]
  signatureId: string
  actor: { iss: string; sub: string }
}): Promise<ApplyDispositionMapResult> {
  const signatureId = input.signatureId.trim()
  if (!signatureId) {
    return {
      ok: false,
      status: 400,
      code: 'signature_required',
      detail: 'An electronic signature is required to Valid empty tips at create',
    }
  }
  const ids = [
    ...new Set(
      input.commitIds.map((id) => id.trim()).filter(Boolean),
    ),
  ]
  if (ids.length === 0) return { ok: true, commitIds: [] }

  const actorKey = signerAuthorKey(input.actor)
  const now = new Date()
  for (const commitId of ids) {
    await getDb()
      .insert(commitQcStatus)
      .values({
        repositoryId: input.repositoryId,
        commitId,
        status: 'valid',
        mergeRequestId: null,
        signatureId,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [commitQcStatus.repositoryId, commitQcStatus.commitId],
        set: {
          status: 'valid',
          updatedAt: now,
          signatureId,
        },
      })
    await getDb().insert(commitQcEvents).values({
      repositoryId: input.repositoryId,
      commitId,
      status: 'valid',
      signatureId,
      actorKey,
      createdAt: now,
    })
  }
  return { ok: true, commitIds: ids }
}

export type CommitQcEventRow = {
  id: string
  commitId: string
  status: DispositionVerdict
  signatureId: string
  actorKey: string
  createdAt: Date
}

/** Newest-first disposition history for a commit (append-only events). */
export async function listCommitQcEvents(
  repositoryId: string,
  commitId: string,
  limit = 50,
): Promise<CommitQcEventRow[]> {
  const id = commitId.trim()
  if (!id) return []
  const rows = await getDb()
    .select()
    .from(commitQcEvents)
    .where(
      and(eq(commitQcEvents.repositoryId, repositoryId), eq(commitQcEvents.commitId, id)),
    )
    .orderBy(desc(commitQcEvents.createdAt))
    .limit(Math.max(1, Math.min(limit, 200)))
  return rows.map((r) => ({
    id: r.id,
    commitId: r.commitId,
    status: r.status === 'invalid' ? 'invalid' : 'valid',
    signatureId: r.signatureId,
    actorKey: r.actorKey,
    createdAt: r.createdAt,
  }))
}

/**
 * Open MR no longer writes QC Marked (ADR 0009). Kept as a no-op for cancel/reject
 * call sites that previously cleared Marked rows.
 */
export async function unmarkCommitsForMergeRequest(
  _repositoryId: string,
  _mergeRequestId: string,
): Promise<string[]> {
  return []
}
