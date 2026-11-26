import type { PrincipalId } from '../session/principal.js'
import { extractMfaEvidence } from '../signing/mfaEvidence.js'

/**
 * TICKET 11: IdP Baseline and Drift Reports
 * 
 * Validates IdP configuration meets regulatory requirements
 * and detects drift between IdP and Mice state.
 */

export interface IdpBaselineRequirements {
  mfaEnabled: boolean
  authTimeAsserted: boolean
  accountLockoutConfigured: boolean
  passwordPolicyConfigured: boolean
}

export interface IdpBaselineResult {
  passed: boolean
  requirements: IdpBaselineRequirements
  timestamp: number
  errors: string[]
}

export interface IdpPrincipalState {
  principal: PrincipalId
  enabled: boolean
  mfaEnrolled: boolean
}

export interface MicePrincipalState {
  principal: PrincipalId
  active: boolean
  hasSigningRights: boolean
}

export interface DriftReport {
  timestamp: number
  drifts: DriftItem[]
  criticalAlarms: string[]
}

export interface DriftItem {
  principal: PrincipalId
  idpState: IdpPrincipalState
  miceState: MicePrincipalState
  severity: 'critical' | 'warning' | 'info'
  description: string
}

export interface IdpOutageIncident {
  incidentId: string
  startTime: number
  endTime?: number
  duration?: number
  affectedOperations: string[]
  severity: 'critical'
}

/**
 * Check if IdP baseline requirements are met.
 */
export function checkIdpBaseline(requirements: IdpBaselineRequirements): IdpBaselineResult {
  const errors: string[] = []
  
  if (!requirements.mfaEnabled) {
    errors.push('MFA must be enabled on IdP')
  }
  
  if (!requirements.authTimeAsserted) {
    errors.push('IdP must assert auth_time')
  }

  if (!requirements.accountLockoutConfigured) {
    errors.push('Account lockout policy must be configured')
  }
  
  if (!requirements.passwordPolicyConfigured) {
    errors.push('Password policy must meet requirements')
  }
  
  return {
    passed: errors.length === 0,
    requirements,
    timestamp: Date.now(),
    errors,
  }
}

/**
 * Derive MFA / auth_time baseline flags from IdP token claims, then run the checklist.
 * Locality: MFA evidence extraction stays in mfaEvidence; this owns the requirements fold.
 */
export function checkIdpBaselineFromClaims(
  payload: Record<string, unknown>,
  extras: Pick<IdpBaselineRequirements, 'accountLockoutConfigured' | 'passwordPolicyConfigured'>,
): IdpBaselineResult {
  const evidence = extractMfaEvidence(payload)
  return checkIdpBaseline({
    mfaEnabled: evidence.hasMfa,
    authTimeAsserted: evidence.authTime !== undefined,
    accountLockoutConfigured: extras.accountLockoutConfigured,
    passwordPolicyConfigured: extras.passwordPolicyConfigured,
  })
}

/**
 * Compare IdP state vs Mice state to detect drift.
 */
export function detectDrift(
  idpPrincipals: IdpPrincipalState[],
  micePrincipals: MicePrincipalState[],
): DriftReport {
  const drifts: DriftItem[] = []
  const criticalAlarms: string[] = []
  
  const miceMap = new Map(
    micePrincipals.map(p => [`${p.principal.iss}|${p.principal.sub}`, p])
  )
  
  for (const idpState of idpPrincipals) {
    const key = `${idpState.principal.iss}|${idpState.principal.sub}`
    const miceState = miceMap.get(key)
    
    if (miceState && miceState.active && !idpState.enabled) {
      const drift: DriftItem = {
        principal: idpState.principal,
        idpState,
        miceState,
        severity: miceState.hasSigningRights ? 'critical' : 'warning',
        description: `Principal is disabled in IdP but active in Mice`,
      }
      drifts.push(drift)
      
      if (miceState.hasSigningRights) {
        criticalAlarms.push(
          `CRITICAL: Principal ${key} has signing rights in Mice but is disabled in IdP`
        )
      }
    }
  }
  
  return {
    timestamp: Date.now(),
    drifts,
    criticalAlarms,
  }
}

/**
 * Record an IdP outage as an incident.
 */
export function recordIdpOutage(
  startTime: number,
  endTime: number | undefined,
  affectedOperations: string[],
): IdpOutageIncident {
  return {
    incidentId: `idp-outage-${startTime}`,
    startTime,
    endTime,
    duration: endTime ? endTime - startTime : undefined,
    affectedOperations,
    severity: 'critical',
  }
}
