import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { getDb, inTransaction, type Tx } from '../../../db/database.js'
import {
  namespaceGroupMembers,
  namespaceMembers,
  namespaceMembershipVersions,
  namespaces,
} from '../../../db/schema.js'
import type { MemberRoleRef } from './authzTypes.js'
import { appendVersionInterval } from '../../platform/index.js'
import { namespaceIdByName, readNamespace } from './authzRepoNamespaceCore.js'
import { rollbackAs, type AuthzRepoResult } from './authzRepoShared.js'

type Result = AuthzRepoResult

export type MembershipSeat = { kind: 'user' | 'group'; key: string; role: string }

export type NamespaceMembershipVersion = {
  validFrom: string
  validTo: string | null
  members: MembershipSeat[]
}

async function snapshotMembershipSeats(tx: Tx, namespaceId: string): Promise<MembershipSeat[]> {
  const users = await tx.select().from(namespaceMembers).where(eq(namespaceMembers.namespaceId, namespaceId))
  const groups = await tx
    .select()
    .from(namespaceGroupMembers)
    .where(eq(namespaceGroupMembers.namespaceId, namespaceId))
  const seats: MembershipSeat[] = [
    ...users.map((r) => ({ kind: 'user' as const, key: r.userKey, role: r.role })),
    ...groups.map((r) => ({ kind: 'group' as const, key: r.groupKey, role: r.role })),
  ]
  return seats.sort((a, b) =>
    a.kind !== b.kind ? a.kind.localeCompare(b.kind) : a.key.localeCompare(b.key),
  )
}

async function closeOpenMembershipVersion(tx: Tx, namespaceId: string, at: Date): Promise<void> {
  await tx
    .update(namespaceMembershipVersions)
    .set({ validTo: at })
    .where(
      and(eq(namespaceMembershipVersions.namespaceId, namespaceId), isNull(namespaceMembershipVersions.validTo)),
    )
}

/** Open the first / next membership-set version (used by namespace seed). */
export async function openMembershipVersion(tx: Tx, namespaceId: string, at: Date): Promise<void> {
  const members = await snapshotMembershipSeats(tx, namespaceId)
  await tx.insert(namespaceMembershipVersions).values({
    namespaceId,
    members,
    validFrom: at,
    validTo: null,
    createdAt: at,
  })
}

/** Append a new membership-set version after a live membership mutation. */
export async function recordMembershipVersion(tx: Tx, namespaceId: string, at = new Date()): Promise<void> {
  await appendVersionInterval({
    at,
    closeOpen: (when) => closeOpenMembershipVersion(tx, namespaceId, when),
    openNext: (when) => openMembershipVersion(tx, namespaceId, when),
  })
}

/** Chronological membership-set versions for a namespace (entity history, not audit). */
export async function listNamespaceMembershipVersions(
  ns: string,
): Promise<NamespaceMembershipVersion[] | null> {
  const settings = await readNamespace(ns)
  if (!settings) return null
  const rows = await getDb()
    .select()
    .from(namespaceMembershipVersions)
    .where(eq(namespaceMembershipVersions.namespaceId, settings.id))
    .orderBy(asc(namespaceMembershipVersions.validFrom))
  return rows.map((r) => ({
    validFrom: r.validFrom.toISOString(),
    validTo: r.validTo ? r.validTo.toISOString() : null,
    members: r.members,
  }))
}

async function lockNamespace(tx: Tx, ns: string): Promise<typeof namespaces.$inferSelect | null> {
  const rows = await tx.select().from(namespaces).where(eq(namespaces.name, ns)).for('update')
  return rows[0] ?? null
}

async function ownerCount(tx: Tx, namespaceId: string): Promise<number> {
  const users = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(namespaceMembers)
    .where(and(eq(namespaceMembers.namespaceId, namespaceId), eq(namespaceMembers.role, 'owner')))
  const groups = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(namespaceGroupMembers)
    .where(and(eq(namespaceGroupMembers.namespaceId, namespaceId), eq(namespaceGroupMembers.role, 'owner')))
  return (users[0]?.n ?? 0) + (groups[0]?.n ?? 0)
}

export async function membershipRefs(
  user: { key: string; groups: string[] },
  ns?: string,
): Promise<Array<{ namespace: string; role: MemberRoleRef }>> {
  const db = getDb()
  const nsId = ns ? await namespaceIdByName(ns) : null
  if (ns && !nsId) return []
  const direct = await db
    .select({ namespace: namespaces.name, role: namespaceMembers.role })
    .from(namespaceMembers)
    .innerJoin(namespaces, eq(namespaces.id, namespaceMembers.namespaceId))
    .where(and(eq(namespaceMembers.userKey, user.key), nsId ? eq(namespaceMembers.namespaceId, nsId) : undefined))
  const viaGroups = user.groups.length
    ? await db
        .select({ namespace: namespaces.name, role: namespaceGroupMembers.role })
        .from(namespaceGroupMembers)
        .innerJoin(namespaces, eq(namespaces.id, namespaceGroupMembers.namespaceId))
        .where(
          and(
            inArray(namespaceGroupMembers.groupKey, user.groups),
            nsId ? eq(namespaceGroupMembers.namespaceId, nsId) : undefined,
          ),
        )
    : []
  return [...direct, ...viaGroups]
}

export async function directMemberRole(ns: string, key: string): Promise<MemberRoleRef | null> {
  const nsId = await namespaceIdByName(ns)
  if (!nsId) return null
  const rows = await getDb()
    .select()
    .from(namespaceMembers)
    .where(and(eq(namespaceMembers.namespaceId, nsId), eq(namespaceMembers.userKey, key)))
    .limit(1)
  return rows[0]?.role ?? null
}

export async function listMemberRows(ns: string): Promise<{
  users: Array<{ key: string; role: MemberRoleRef }>
  groups: Array<{ group: string; role: MemberRoleRef }>
}> {
  const nsId = await namespaceIdByName(ns)
  if (!nsId) return { users: [], groups: [] }
  const db = getDb()
  const users = await db.select().from(namespaceMembers).where(eq(namespaceMembers.namespaceId, nsId))
  const groups = await db.select().from(namespaceGroupMembers).where(eq(namespaceGroupMembers.namespaceId, nsId))
  return {
    users: users.map((r) => ({ key: r.userKey, role: r.role })),
    groups: groups.map((r) => ({ group: r.groupKey, role: r.role })),
  }
}

export async function memberCounts(): Promise<Map<string, number>> {
  const db = getDb()
  const out = new Map<string, number>()
  const add = (rows: Array<{ namespace: string; n: number }>) => {
    for (const r of rows) out.set(r.namespace, (out.get(r.namespace) ?? 0) + r.n)
  }
  add(
    await db
      .select({ namespace: namespaces.name, n: sql<number>`count(*)::int` })
      .from(namespaceMembers)
      .innerJoin(namespaces, eq(namespaces.id, namespaceMembers.namespaceId))
      .groupBy(namespaces.name),
  )
  add(
    await db
      .select({ namespace: namespaces.name, n: sql<number>`count(*)::int` })
      .from(namespaceGroupMembers)
      .innerJoin(namespaces, eq(namespaces.id, namespaceGroupMembers.namespaceId))
      .groupBy(namespaces.name),
  )
  return out
}

export async function isMemberRoleAssigned(ns: string, roleId: string): Promise<boolean> {
  const nsId = await namespaceIdByName(ns)
  if (!nsId) return false
  const db = getDb()
  const u = await db
    .select()
    .from(namespaceMembers)
    .where(and(eq(namespaceMembers.namespaceId, nsId), eq(namespaceMembers.role, roleId)))
    .limit(1)
  if (u.length) return true
  const g = await db
    .select()
    .from(namespaceGroupMembers)
    .where(and(eq(namespaceGroupMembers.namespaceId, nsId), eq(namespaceGroupMembers.role, roleId)))
    .limit(1)
  return g.length > 0
}

export async function ownedNamespaceNames(user: { key: string; groups: string[] }): Promise<string[]> {
  const refs = await membershipRefs(user)
  return [...new Set(refs.filter((r) => r.role === 'owner').map((r) => r.namespace))]
}

export async function setMember(ns: string, key: string, role: MemberRoleRef): Promise<Result> {
  return inTransaction(async (tx) => {
    const locked = await lockNamespace(tx, ns)
    if (!locked) return { ok: false, error: 'Namespace not found' } as const
    const prev = (
      await tx
        .select()
        .from(namespaceMembers)
        .where(and(eq(namespaceMembers.namespaceId, locked.id), eq(namespaceMembers.userKey, key)))
    )[0]?.role
    if (prev === role) return { ok: true } as const
    await tx
      .insert(namespaceMembers)
      .values({ namespaceId: locked.id, userKey: key, role })
      .onConflictDoUpdate({ target: [namespaceMembers.namespaceId, namespaceMembers.userKey], set: { role } })
    if (prev === 'owner' && role !== 'owner' && (await ownerCount(tx, locked.id)) === 0) {
      tx.rollback()
    }
    await recordMembershipVersion(tx, locked.id)
    return { ok: true } as const
  }).catch((e: unknown) => rollbackAs(e, 'Cannot demote the last namespace Owner'))
}

export async function removeMember(ns: string, key: string): Promise<Result> {
  return inTransaction(async (tx) => {
    const locked = await lockNamespace(tx, ns)
    if (!locked) return { ok: false, error: 'Namespace not found' } as const
    const cur = (
      await tx
        .select()
        .from(namespaceMembers)
        .where(and(eq(namespaceMembers.namespaceId, locked.id), eq(namespaceMembers.userKey, key)))
    )[0]
    if (!cur) return { ok: true } as const
    if (cur.role === 'owner' && (await ownerCount(tx, locked.id)) <= 1) {
      return { ok: false, error: 'Cannot remove the last namespace Owner' } as const
    }
    await tx
      .delete(namespaceMembers)
      .where(and(eq(namespaceMembers.namespaceId, locked.id), eq(namespaceMembers.userKey, key)))
    await recordMembershipVersion(tx, locked.id)
    return { ok: true } as const
  })
}

export async function setGroupMember(ns: string, group: string, role: MemberRoleRef): Promise<Result> {
  return inTransaction(async (tx) => {
    const locked = await lockNamespace(tx, ns)
    if (!locked) return { ok: false, error: 'Namespace not found' } as const
    const prev = (
      await tx
        .select()
        .from(namespaceGroupMembers)
        .where(and(eq(namespaceGroupMembers.namespaceId, locked.id), eq(namespaceGroupMembers.groupKey, group)))
    )[0]?.role
    if (prev === role) return { ok: true } as const
    await tx
      .insert(namespaceGroupMembers)
      .values({ namespaceId: locked.id, groupKey: group, role })
      .onConflictDoUpdate({
        target: [namespaceGroupMembers.namespaceId, namespaceGroupMembers.groupKey],
        set: { role },
      })
    if (prev === 'owner' && role !== 'owner' && (await ownerCount(tx, locked.id)) === 0) {
      tx.rollback()
    }
    await recordMembershipVersion(tx, locked.id)
    return { ok: true } as const
  }).catch((e: unknown) => rollbackAs(e, 'Cannot demote the last namespace Owner'))
}

export async function removeGroupMember(ns: string, group: string): Promise<Result> {
  return inTransaction(async (tx) => {
    const locked = await lockNamespace(tx, ns)
    if (!locked) return { ok: false, error: 'Namespace not found' } as const
    const cur = (
      await tx
        .select()
        .from(namespaceGroupMembers)
        .where(and(eq(namespaceGroupMembers.namespaceId, locked.id), eq(namespaceGroupMembers.groupKey, group)))
    )[0]
    if (!cur) return { ok: false, error: 'Group member not found' } as const
    if (cur.role === 'owner' && (await ownerCount(tx, locked.id)) <= 1) {
      return { ok: false, error: 'Cannot remove the last namespace Owner' } as const
    }
    await tx
      .delete(namespaceGroupMembers)
      .where(and(eq(namespaceGroupMembers.namespaceId, locked.id), eq(namespaceGroupMembers.groupKey, group)))
    await recordMembershipVersion(tx, locked.id)
    return { ok: true } as const
  })
}
