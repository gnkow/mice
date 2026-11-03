import { and, eq } from 'drizzle-orm'
import { getDb } from './db/database.js'
import { groupDisplayNames } from './db/schema.js'
import { directoryNow } from './authentication/directory/directory.js'
import { canonicalIssuer } from './authentication/session/principal.js'
import { env } from './env.js'
import { groupBindingKey, parseGroupBindingKey } from './groupBinding.js'

/** Issuer stamped on group binding keys when the caller does not pass one. */
export function defaultGroupIssuer(): string {
  try {
    const directory = directoryNow()
    if (directory.configured && directory.issuer) return canonicalIssuer(directory.issuer)
  } catch {
    /* directory may be unavailable in early unit tests */
  }
  return canonicalIssuer(env.oidcIssuerPublic || 'test')
}

export type GroupDisplayRow = {
  bindingKey: string
  displayName: string
  idBased: boolean
  updatedAt: Date
}

/** Upsert display names for groups seen at login or when a grant is written. */
export async function upsertGroupDisplayNames(
  rows: Array<{ bindingKey: string; displayName: string; idBased: boolean }>,
): Promise<void> {
  if (!rows.length) return
  const db = getDb()
  const now = new Date()
  for (const row of rows) {
    const parsed = parseGroupBindingKey(row.bindingKey)
    if (!parsed) continue
    const name = row.displayName.trim() || parsed.groupId
    await db
      .insert(groupDisplayNames)
      .values({
        issuer: parsed.iss,
        groupId: parsed.groupId,
        displayName: name,
        idBased: row.idBased,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [groupDisplayNames.issuer, groupDisplayNames.groupId],
        set: {
          displayName: name,
          idBased: row.idBased,
          updatedAt: now,
        },
      })
  }
}

export async function getGroupDisplayName(bindingKey: string): Promise<string | undefined> {
  const parsed = parseGroupBindingKey(bindingKey)
  if (!parsed) return undefined
  const [row] = await getDb()
    .select({ displayName: groupDisplayNames.displayName })
    .from(groupDisplayNames)
    .where(
      and(
        eq(groupDisplayNames.issuer, parsed.iss),
        eq(groupDisplayNames.groupId, parsed.groupId),
      ),
    )
    .limit(1)
  return row?.displayName
}

export async function getGroupDisplayNames(
  bindingKeys: string[],
): Promise<Map<string, { displayName: string; idBased: boolean }>> {
  const out = new Map<string, { displayName: string; idBased: boolean }>()
  for (const key of bindingKeys) {
    const parsed = parseGroupBindingKey(key)
    if (!parsed) continue
    const [row] = await getDb()
      .select({
        displayName: groupDisplayNames.displayName,
        idBased: groupDisplayNames.idBased,
      })
      .from(groupDisplayNames)
      .where(
        and(
          eq(groupDisplayNames.issuer, parsed.iss),
          eq(groupDisplayNames.groupId, parsed.groupId),
        ),
      )
      .limit(1)
    if (row) out.set(key, { displayName: row.displayName, idBased: row.idBased })
  }
  return out
}

/** Convenience for directory hits: cache `iss|id` → name. */
export async function rememberDirectoryGroup(
  iss: string,
  groupId: string,
  displayName: string,
  idBased = true,
): Promise<string> {
  const bindingKey = groupBindingKey(canonicalIssuer(iss), groupId)
  await upsertGroupDisplayNames([{ bindingKey, displayName, idBased }])
  return bindingKey
}
