import { asc, eq } from 'drizzle-orm'
import { appendAudit } from '../../audit.js'
import { getDb } from '../../db/database.js'
import { webSessions } from '../../db/schema.js'

/** Concurrent web Sessions allowed per Principal (Round 8 U4 / Ticket 15). */
export const WEB_SESSION_CAP = 5

export type CapSessionRow = { idHash: string; sessionStart: number }

export type SessionCapActor = {
  sub: string
  iss: string
  email: string
  name: string
}

/**
 * When existing sessions (oldest-first) are at or over the cap, return the
 * oldest row to delete before inserting a new Session.
 */
export function sessionToEvictForCap(
  existingOldestFirst: CapSessionRow[],
  cap: number = WEB_SESSION_CAP,
): CapSessionRow | null {
  if (existingOldestFirst.length < cap) return null
  return existingOldestFirst[0] ?? null
}

export type EnforceWebSessionCapResult = {
  /** Oldest session removed to make room, or null when under the cap. */
  evicted: CapSessionRow | null
}

/**
 * Enforce the per-Principal web Session cap: if at cap, delete the oldest
 * Session and append `session.evict` with reason `cap-exceeded`.
 * Callers learn the eviction outcome from the return value — no audit side-channel.
 */
export async function enforceWebSessionCap(input: {
  principalId: number
  actor: SessionCapActor
}): Promise<EnforceWebSessionCapResult> {
  const existingSessions = await getDb()
    .select({
      idHash: webSessions.idHash,
      sessionStart: webSessions.sessionStart,
    })
    .from(webSessions)
    .where(eq(webSessions.principalId, input.principalId))
    .orderBy(asc(webSessions.sessionStart))

  const oldest = sessionToEvictForCap(existingSessions)
  if (!oldest) return { evicted: null }

  await getDb().delete(webSessions).where(eq(webSessions.idHash, oldest.idHash))

  await appendAudit({
    actor: {
      sub: input.actor.sub,
      iss: input.actor.iss,
      email: input.actor.email,
      name: input.actor.name,
    },
    via: 'system',
    method: 'POST',
    path: '/auth/session/seal',
    status: 200,
    action: 'session.evict',
    message: `Session evicted: cap exceeded (${WEB_SESSION_CAP} concurrent sessions max)`,
    detail: {
      evictedSessionHash: oldest.idHash,
      evictedSessionStart: oldest.sessionStart,
      reason: 'cap-exceeded',
      cap: WEB_SESSION_CAP,
    },
  })

  return { evicted: oldest }
}
