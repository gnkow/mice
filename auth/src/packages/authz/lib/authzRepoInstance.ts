import { eq, sql } from 'drizzle-orm'
import { getDb, inTransaction } from '../../../db/database.js'
import { instancePermissions, instanceTraining } from '../../../db/schema.js'
import type { InstancePermission } from './authzTypes.js'

export async function instancePermissionsOf(
  key: string,
  now = Date.now(),
): Promise<InstancePermission[]> {
  const rows = await getDb().select().from(instancePermissions).where(eq(instancePermissions.userKey, key))
  return rows
    .filter((r) => r.expiresAt.getTime() > now)
    .map((r) => r.permission as InstancePermission)
}

export async function replaceInstancePermissions(
  key: string,
  perms: InstancePermission[],
  expiresAt: Date,
): Promise<void> {
  await inTransaction(async (tx) => {
    await tx.delete(instancePermissions).where(eq(instancePermissions.userKey, key))
    if (perms.length) {
      await tx.insert(instancePermissions).values(
        perms.map((permission) => ({ userKey: key, permission, expiresAt })),
      )
    }
  })
}

export async function listInstancePermissionRows(): Promise<
  Array<{ key: string; permissions: InstancePermission[]; expiresAt: number }>
> {
  const rows = await getDb().select().from(instancePermissions)
  const by = new Map<string, { permissions: InstancePermission[]; expiresAt: number }>()
  for (const r of rows) {
    const expiresAt = r.expiresAt.getTime()
    const cur = by.get(r.userKey)
    if (!cur) {
      by.set(r.userKey, { permissions: [r.permission as InstancePermission], expiresAt })
    } else {
      cur.permissions.push(r.permission as InstancePermission)
      if (expiresAt < cur.expiresAt) cur.expiresAt = expiresAt
    }
  }
  return [...by].map(([key, v]) => ({ key, permissions: v.permissions, expiresAt: v.expiresAt }))
}

/** Deletes instance permission rows whose expires_at is at or before `now`. */
export async function deleteExpiredInstancePermissions(
  now = Date.now(),
): Promise<Array<{ key: string; permissions: InstancePermission[]; expiresAt: number }>> {
  const cutoff = new Date(now)
  const expired = await getDb()
    .select()
    .from(instancePermissions)
    .where(sql`${instancePermissions.expiresAt} <= ${cutoff}`)
  if (expired.length === 0) return []
  const by = new Map<string, { permissions: InstancePermission[]; expiresAt: number }>()
  for (const r of expired) {
    const expiresAt = r.expiresAt.getTime()
    const cur = by.get(r.userKey)
    if (!cur) {
      by.set(r.userKey, { permissions: [r.permission as InstancePermission], expiresAt })
    } else {
      cur.permissions.push(r.permission as InstancePermission)
      if (expiresAt < cur.expiresAt) cur.expiresAt = expiresAt
    }
  }
  await getDb().delete(instancePermissions).where(sql`${instancePermissions.expiresAt} <= ${cutoff}`)
  return [...by].map(([key, v]) => ({ key, permissions: v.permissions, expiresAt: v.expiresAt }))
}

export async function isTrained(key: string): Promise<boolean> {
  const rows = await getDb().select().from(instanceTraining).where(eq(instanceTraining.userKey, key)).limit(1)
  return rows.length > 0
}

export async function writeTrained(key: string, done: boolean): Promise<void> {
  if (done) await getDb().insert(instanceTraining).values({ userKey: key }).onConflictDoNothing()
  else await getDb().delete(instanceTraining).where(eq(instanceTraining.userKey, key))
}
