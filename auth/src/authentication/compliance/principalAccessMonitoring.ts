/**
 * Principal Access State Monitoring (Ticket 11 - U4, U5)
 * 
 * Monitors and alerts when Principals have inappropriate access:
 * - Disabled in IdP but still have signing rights in Mice
 * - Principal state drift between IdP and Mice
 */

import { getDb } from '../../db/database.js'
import { principals } from '../../db/schema.js'
import { eq } from 'drizzle-orm'
import { directoryNow } from '../directory/directory.js'
import type { DirectoryUserStatus } from '../directory/directoryTypes.js'

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

/**
 * Check if a Principal has signing rights in Mice.
 * This is a simplified check - in production, this would query the authz system.
 */
async function hasSigningRights(principalId: number): Promise<boolean> {
  // For now, assume all active Principals can potentially sign
  // In production, this would check specific roles/permissions
  const [principal] = await getDb()
    .select()
    .from(principals)
    .where(eq(principals.id, principalId))
    .limit(1)
  
  return !!principal
}

/**
 * Get IdP status for a Principal.
 */
async function getIdpStatus(sub: string): Promise<{ enabled: boolean } | null> {
  const directory = directoryNow()
  
  if (!directory.configured) {
    return null
  }
  
  try {
    const account = await directory.userStatus(sub)
    return { enabled: account.status === 'enabled' }
  } catch (error) {
    console.error(`[mice-auth] Failed to check IdP status for ${sub}:`, error)
    return null
  }
}

/**
 * Check all Principals for disabled-in-IdP with signing rights.
 * Returns list of Principals that should trigger alarms.
 */
export async function checkDisabledPrincipalsWithSigningRights(): Promise<DisabledPrincipalAlarm[]> {
  const alarms: DisabledPrincipalAlarm[] = []
  
  // Get all Principals
  const allPrincipals = await getDb()
    .select()
    .from(principals)
  
  for (const principal of allPrincipals) {
    // Check if has signing rights
    const canSign = await hasSigningRights(principal.id)
    if (!canSign) {
      continue
    }
    
    // Check IdP status
    const idpStatus = await getIdpStatus(principal.sub)
    if (!idpStatus) {
      // IdP unavailable - skip this check
      continue
    }
    
    // Alarm if disabled in IdP but has signing rights in Mice
    if (!idpStatus.enabled) {
      alarms.push({
        principalId: principal.id,
        sub: principal.sub,
        iss: principal.iss,
        name: principal.name ?? principal.sub,
        severity: 'critical',
        reason: 'Principal is disabled in IdP but still has signing rights in Mice',
      })
    }
  }
  
  return alarms
}

/**
 * Get detailed access state for a Principal.
 */
export async function getPrincipalAccessState(
  principalId: number
): Promise<PrincipalAccessState | null> {
  const [principal] = await getDb()
    .select()
    .from(principals)
    .where(eq(principals.id, principalId))
    .limit(1)
  
  if (!principal) {
    return null
  }
  
  const idpStatus = await getIdpStatus(principal.sub)
  const canSign = await hasSigningRights(principal.id)
  
  return {
    principalId: principal.id,
    sub: principal.sub,
    iss: principal.iss,
    name: principal.name ?? principal.sub,
    idpEnabled: idpStatus?.enabled ?? false,
    miceActive: true, // Would check actual active status
    hasSigningRights: canSign,
  }
}

/**
 * Run the daily check for disabled Principals with signing rights.
 * Logs alarms and returns the count.
 */
export async function runDisabledPrincipalCheck(): Promise<{
  alarmsFound: number
  alarms: DisabledPrincipalAlarm[]
}> {
  const alarms = await checkDisabledPrincipalsWithSigningRights()
  
  if (alarms.length > 0) {
    console.error(
      `[mice-auth] CRITICAL: ${alarms.length} disabled Principal(s) with signing rights detected:`
    )
    for (const alarm of alarms) {
      console.error(
        `  - ${alarm.name} (${alarm.sub}): ${alarm.reason}`
      )
    }
  }
  
  return {
    alarmsFound: alarms.length,
    alarms,
  }
}
