import { eq } from 'drizzle-orm'
import { getDb, type Tx } from '../../../db/database.js'
import { namespaces } from '../../../db/schema.js'
import type { BasePermission } from './authzTypes.js'

export type NamespaceSettings = {
  id: string
  name: string
  description: string
  basePermission: BasePermission
  membersCanCreateRepos: boolean
  createdAt: string
  createdBy: string
}

export type NamespaceSettingsPatch = Partial<{
  name: string
  description: string
  basePermission: BasePermission
  membersCanCreateRepos: boolean
}>

export type NamespaceSettingsVersion = {
  validFrom: string
  validTo: string | null
  name: string
  description: string
  basePermission: BasePermission
  membersCanCreateRepos: boolean
}

/** Create returns the minted stable namespace id so callers need not re-read by name. */
export type CreateNamespaceResult = { ok: true; id: string } | { ok: false; error: string }

export function toSettings(r: typeof namespaces.$inferSelect): NamespaceSettings {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    basePermission: r.basePermission as BasePermission,
    membersCanCreateRepos: r.membersCanCreateRepos,
    createdAt: r.createdAt.toISOString(),
    createdBy: r.createdBy,
  }
}

export async function namespaceIdByName(name: string, tx: Tx | ReturnType<typeof getDb> = getDb()): Promise<string | null> {
  const rows = await tx.select({ id: namespaces.id }).from(namespaces).where(eq(namespaces.name, name)).limit(1)
  return rows[0]?.id ?? null
}

export async function namespaceNameById(id: string, tx: Tx | ReturnType<typeof getDb> = getDb()): Promise<string | null> {
  const rows = await tx.select({ name: namespaces.name }).from(namespaces).where(eq(namespaces.id, id)).limit(1)
  return rows[0]?.name ?? null
}

export async function readNamespace(name: string): Promise<NamespaceSettings | null> {
  const rows = await getDb().select().from(namespaces).where(eq(namespaces.name, name)).limit(1)
  return rows[0] ? toSettings(rows[0]) : null
}

export async function readNamespaceById(id: string): Promise<NamespaceSettings | null> {
  const rows = await getDb().select().from(namespaces).where(eq(namespaces.id, id)).limit(1)
  return rows[0] ? toSettings(rows[0]) : null
}

export async function readNamespaces(): Promise<Record<string, NamespaceSettings>> {
  const rows = await getDb().select().from(namespaces)
  return Object.fromEntries(rows.map((r) => [r.name, toSettings(r)]))
}
