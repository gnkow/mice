/**
 * Principal Access State Monitoring (Ticket 11 - U4, U5)
 *
 * Alarms when a Principal is disabled in the IdP and still holds signing rights in Mice.
 */

import { getDb } from '../../db/database.js'
import { principals } from '../../db/schema.js'
import { eq } from 'drizzle-orm'
import { directoryNow } from '../directory/directory.js'

export type PrincipalAccessState = {
  principalId: number
  sub: string
  iss: string
  name: string
  idpEnabled: boolean
  miceActive: boolean
  hasSigningRights: boolean
}

export type DisabledPrincipalAlarm = {
  principalId: number
  sub: string
  iss: string
  name: string
  severity: 'critical'
  reason: string
}

/** One Principal's IdP + Mice access facts used to decide alarms. */
export type AccessSnapshot = {
  principalId: number
  sub: string
  iss: string
  name: string
  /** `null` when the directory could not answer. */
  idpEnabled: boolean | null
  hasSigningRights: boolean
}

export type PrincipalRow = {
  id: number
  sub: string
  iss: string
  name: string | null
}

export type PrincipalAccessMonitorDeps = {
  listPrincipals?: () => Promise<PrincipalRow[]>
  /** Load one Principal for `state`; defaults to a DB lookup. */
  findPrincipal?: (principalId: number) => Promise<PrincipalRow | null>
  idpEnabled?: (sub: string) => Promise<boolean | null>
  hasSigningRights?: (principalId: number) => Promise<boolean>
  logCritical?: (alarms: DisabledPrincipalAlarm[]) => void
}

export type PrincipalAccessMonitor = {
  check(): Promise<DisabledPrincipalAlarm[]>
  run(): Promise<{ alarmsFound: number; alarms: DisabledPrincipalAlarm[] }>
  state(principalId: number): Promise<PrincipalAccessState | null>
}

const CRITICAL_REASON =
  'Principal is disabled in IdP but still has signing rights in Mice'

/** Pure classification: disabled-in-IdP + signing rights → critical alarm. */
export function alarmsFromAccessSnapshots(
  snapshots: AccessSnapshot[],
): DisabledPrincipalAlarm[] {
  const alarms: DisabledPrincipalAlarm[] = []
  for (const s of snapshots) {
    if (s.idpEnabled === null || s.idpEnabled || !s.hasSigningRights) continue
    alarms.push({
      principalId: s.principalId,
      sub: s.sub,
      iss: s.iss,
      name: s.name,
      severity: 'critical',
      reason: CRITICAL_REASON,
    })
  }
  return alarms
}

async function defaultListPrincipals(): Promise<PrincipalRow[]> {
  return getDb().select().from(principals)
}

async function defaultFindPrincipal(principalId: number): Promise<PrincipalRow | null> {
  const [principal] = await getDb()
    .select()
    .from(principals)
    .where(eq(principals.id, principalId))
    .limit(1)
  return principal ?? null
}

async function defaultIdpEnabled(sub: string): Promise<boolean | null> {
  const directory = directoryNow()
  if (!directory.configured) return null
  try {
    const account = await directory.userStatus(sub)
    if (account.status === 'error') return null
    return account.status !== 'disabled'
  } catch (error) {
    console.error(`[mice-auth] Failed to check IdP status for ${sub}:`, error)
    return null
  }
}

/** Signing rights: Principal exists in Mice (port; replace when authz exposes a tighter check). */
async function defaultHasSigningRights(principalId: number): Promise<boolean> {
  return (await defaultFindPrincipal(principalId)) !== null
}

function defaultLogCritical(alarms: DisabledPrincipalAlarm[]): void {
  console.error(
    `[mice-auth] CRITICAL: ${alarms.length} disabled Principal(s) with signing rights detected:`,
  )
  for (const alarm of alarms) {
    console.error(`  - ${alarm.name} (${alarm.sub}): ${alarm.reason}`)
  }
}

/**
 * Deep monitor: load Principals, ask IdP + signing ports, classify alarms.
 * Callers only learn `check` / `run` / `state`.
 */
export function createPrincipalAccessMonitor(
  deps: PrincipalAccessMonitorDeps = {},
): PrincipalAccessMonitor {
  const listPrincipals = deps.listPrincipals ?? defaultListPrincipals
  const findPrincipal = deps.findPrincipal ?? defaultFindPrincipal
  const idpEnabled = deps.idpEnabled ?? defaultIdpEnabled
  const hasSigningRights = deps.hasSigningRights ?? defaultHasSigningRights
  const logCritical = deps.logCritical ?? defaultLogCritical

  async function snapshotsFor(rows: PrincipalRow[]): Promise<AccessSnapshot[]> {
    return Promise.all(
      rows.map(async (p) => ({
        principalId: p.id,
        sub: p.sub,
        iss: p.iss,
        name: p.name ?? p.sub,
        idpEnabled: await idpEnabled(p.sub),
        hasSigningRights: await hasSigningRights(p.id),
      })),
    )
  }

  async function check(): Promise<DisabledPrincipalAlarm[]> {
    return alarmsFromAccessSnapshots(await snapshotsFor(await listPrincipals()))
  }

  async function run(): Promise<{ alarmsFound: number; alarms: DisabledPrincipalAlarm[] }> {
    const alarms = await check()
    if (alarms.length > 0) logCritical(alarms)
    return { alarmsFound: alarms.length, alarms }
  }

  async function state(principalId: number): Promise<PrincipalAccessState | null> {
    const principal = await findPrincipal(principalId)
    if (!principal) return null

    const [snapshot] = await snapshotsFor([principal])

    return {
      principalId: principal.id,
      sub: principal.sub,
      iss: principal.iss,
      name: principal.name ?? principal.sub,
      idpEnabled: snapshot.idpEnabled ?? false,
      miceActive: true,
      hasSigningRights: snapshot.hasSigningRights,
    }
  }

  return { check, run, state }
}

const live = createPrincipalAccessMonitor()

export const checkDisabledPrincipalsWithSigningRights = live.check
export const runDisabledPrincipalCheck = live.run
export const getPrincipalAccessState = live.state
