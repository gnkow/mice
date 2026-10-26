import { eq } from 'drizzle-orm'
import { getDb } from './db/database.js'
import { notificationCursor, notificationTombstones, notificationUsers } from './db/schema.js'
import type { SessionUser } from './authentication/session/session.js'
import type { NotificationPreferences } from './notificationsTypes.js'

export type NotificationUser = {
  identity: Pick<SessionUser, 'iss' | 'sub' | 'email' | 'name' | 'groups'>
  rememberedAt: string
  claimsAt: string
}

export type KnownNotificationUser = NotificationUser & { key: string; preferences?: NotificationPreferences }

export function notificationUserKey(user: { iss: string; sub: string }): string {
  return JSON.stringify([user.iss, user.sub])
}

const identityOf = (user: SessionUser): NotificationUser['identity'] => ({
  iss: user.iss, sub: user.sub, email: user.email, name: user.name,
  ...(user.groups ? { groups: [...user.groups] } : {}),
})

const sameIdentity = (a: NotificationUser['identity'], b: NotificationUser['identity']) =>
  a.email === b.email && a.name === b.name && JSON.stringify(a.groups ?? null) === JSON.stringify(b.groups ?? null)

const toKnown = (row: typeof notificationUsers.$inferSelect): KnownNotificationUser => ({
  key: row.userKey,
  identity: row.identity,
  rememberedAt: row.rememberedAt.toISOString(),
  claimsAt: row.claimsAt.toISOString(),
  ...(row.preferences ? { preferences: row.preferences } : {}),
})

/** Records the identity and claims seen at authentication; a fresh identity is rewritten at most once a minute. */
export async function saveNotificationUser(user: SessionUser): Promise<void> {
  const key = notificationUserKey(user)
  const identity = identityOf(user)
  const now = new Date()
  const [known] = await getDb().select().from(notificationUsers).where(eq(notificationUsers.userKey, key))
  if (known && sameIdentity(known.identity, identity) && now.getTime() - known.claimsAt.getTime() < 60_000) return
  await getDb()
    .insert(notificationUsers)
    .values({ userKey: key, identity, rememberedAt: now, claimsAt: now })
    .onConflictDoUpdate({ target: notificationUsers.userKey, set: { identity, claimsAt: now } })
}

export async function listNotificationUsers(): Promise<KnownNotificationUser[]> {
  return (await getDb().select().from(notificationUsers)).map(toKnown)
}

export async function getNotificationUser(key: string): Promise<KnownNotificationUser | undefined> {
  const [row] = await getDb().select().from(notificationUsers).where(eq(notificationUsers.userKey, key))
  return row ? toKnown(row) : undefined
}

export async function saveNotificationPreferences(user: SessionUser, preferences: NotificationPreferences): Promise<void> {
  const key = notificationUserKey(user)
  const now = new Date()
  await getDb()
    .insert(notificationUsers)
    .values({ userKey: key, identity: identityOf(user), rememberedAt: now, claimsAt: now, preferences })
    .onConflictDoUpdate({ target: notificationUsers.userKey, set: { preferences } })
}

export async function recordNotificationTombstone(resource: string, deletedAt: Date): Promise<void> {
  await getDb()
    .insert(notificationTombstones)
    .values({ resource, deletedAt })
    .onConflictDoUpdate({ target: notificationTombstones.resource, set: { deletedAt } })
}

export async function listNotificationTombstones(): Promise<Map<string, string>> {
  const rows = await getDb().select().from(notificationTombstones)
  return new Map(rows.map((r) => [r.resource, r.deletedAt.toISOString()]))
}

export async function getNotificationCursor(): Promise<number> {
  const [row] = await getDb().select().from(notificationCursor)
  return row?.auditSeq ?? 0
}

export async function setNotificationCursor(auditSeq: number): Promise<void> {
  await getDb()
    .insert(notificationCursor)
    .values({ id: 1, auditSeq })
    .onConflictDoUpdate({ target: notificationCursor.id, set: { auditSeq } })
}
