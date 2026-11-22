import { eq, inArray } from 'drizzle-orm'
import { getDb } from './db/database.js'
import { commitAttributions } from './db/schema.js'
import type { HumanCommitFields } from './authentication/commits/commitIdentity.js'

/** Default empty-tip message when the client does not supply one. */
export const DEFAULT_EMPTY_TIP_MESSAGE = 'Initialized Repo'

export type CommitAttribution = HumanCommitFields & {
  name?: string | null
  message?: string | null
}

export function normalizeEmptyTipMessage(message?: string | null): string {
  const trimmed = message?.trim()
  return trimmed || DEFAULT_EMPTY_TIP_MESSAGE
}

/** Persist BFF identity for a commit oxen stamped as Oxen (empty-tip bootstrap). */
export async function recordCommitAttribution(
  commitId: string,
  fields: HumanCommitFields & { name?: string | null; message?: string | null },
): Promise<void> {
  const id = commitId.trim()
  if (!id) return
  const message = normalizeEmptyTipMessage(fields.message)
  await getDb()
    .insert(commitAttributions)
    .values({
      commitId: id,
      author: fields.author,
      email: fields.email,
      name: fields.name?.trim() || null,
      message,
    })
    .onConflictDoUpdate({
      target: commitAttributions.commitId,
      set: {
        author: fields.author,
        email: fields.email,
        name: fields.name?.trim() || null,
        message,
      },
    })
}

export async function getCommitAttributions(
  commitIds: string[],
): Promise<Map<string, CommitAttribution>> {
  const ids = [...new Set(commitIds.map((c) => c.trim()).filter(Boolean))]
  const out = new Map<string, CommitAttribution>()
  if (ids.length === 0) return out
  const rows = await getDb()
    .select()
    .from(commitAttributions)
    .where(inArray(commitAttributions.commitId, ids))
  for (const row of rows) {
    out.set(row.commitId, {
      author: row.author,
      email: row.email,
      name: row.name,
      message: row.message,
    })
  }
  return out
}

/**
 * Rewrite commit author/email/message in oxen JSON using BFF attributions only.
 * Walks common shapes: `{ commit }`, `{ commits: [] }`, nested workspace.commit.
 */
export async function rewriteCommitAuthorsInOxenJson(body: string): Promise<string> {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return body
  }
  const ids: string[] = []
  collectCommitIds(parsed, ids)
  if (ids.length === 0) return body
  let attrs: Map<string, CommitAttribution>
  try {
    attrs = await getCommitAttributions(ids)
  } catch {
    return body
  }
  if (attrs.size === 0) return body
  applyAttributions(parsed, attrs)
  return JSON.stringify(parsed)
}

function collectCommitIds(value: unknown, out: string[]): void {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const v of value) collectCommitIds(v, out)
    return
  }
  const obj = value as Record<string, unknown>
  if (typeof obj.id === 'string' && ('author' in obj || 'email' in obj || 'message' in obj)) {
    out.push(obj.id)
  }
  for (const v of Object.values(obj)) collectCommitIds(v, out)
}

function applyAttributions(value: unknown, attrs: Map<string, CommitAttribution>): void {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const v of value) applyAttributions(v, attrs)
    return
  }
  const obj = value as Record<string, unknown>
  if (typeof obj.id === 'string' && attrs.has(obj.id)) {
    const a = attrs.get(obj.id)!
    obj.author = a.author
    obj.email = a.email
    obj.message = normalizeEmptyTipMessage(a.message)
  }
  for (const v of Object.values(obj)) applyAttributions(v, attrs)
}

export async function getCommitAttribution(
  commitId: string,
): Promise<CommitAttribution | null> {
  const id = commitId.trim()
  if (!id) return null
  const [row] = await getDb()
    .select()
    .from(commitAttributions)
    .where(eq(commitAttributions.commitId, id))
    .limit(1)
  if (!row) return null
  return {
    author: row.author,
    email: row.email,
    name: row.name,
    message: row.message,
  }
}
