/**
 * MFA Evidence Extraction
 * 
 * Part 11 §11.200 requires "two distinct identification components" at signing.
 * This module extracts and validates MFA evidence (acr, amr) from IdP claims.
 * 
 * Related:
 * - Round 8 decision U1: IdP MFA capability is a deployment prerequisite
 * - Round 8 decision U19: Signature records store claims AND verification metadata
 * - .scratch/authentication/issues/14-idp-mfa-baseline-validation.md
 */

export interface MfaEvidence {
  /** True if MFA was used (both acr present AND amr contains multiple methods) */
  hasMfa: boolean
  /** Authentication Context Class Reference (e.g., "mfa", "password", "2") */
  acr?: string
  /** Authentication Methods References (e.g., ["pwd", "otp"]) */
  amr: string[]
  /** Epoch seconds of authentication (from auth_time claim) */
  authTime?: number
}

/**
 * Standard MFA indicators in the amr (Authentication Methods Reference) claim.
 * 
 * From RFC 8176 (Authentication Method Reference Values):
 * - otp: One-time password
 * - sms: SMS-based OTP
 * - hwk: Hardware key (e.g., YubiKey)
 * - swk: Software key
 * - tel: Telephone call
 * - fpt: Fingerprint biometric
 * - mfa: Explicit MFA indicator (some IdPs use this)
 */
const MFA_INDICATORS = new Set(['otp', 'sms', 'hwk', 'swk', 'tel', 'fpt', 'mfa'])

/**
 * Extract MFA evidence from id_token payload claims.
 * 
 * MFA is considered present when:
 * 1. acr claim is present (authentication context)
 * 2. amr claim is present AND
 * 3. amr contains multiple methods OR contains a standard MFA indicator
 * 
 * @param payload Decoded id_token payload (claims)
 * @returns MFA evidence with hasMfa determination
 */
export function extractMfaEvidence(payload: Record<string, unknown>): MfaEvidence {
  const acr = typeof payload.acr === 'string' ? payload.acr : undefined
  const authTime = typeof payload.auth_time === 'number' ? payload.auth_time : undefined

  // Normalize amr to array (handle single string or array)
  let amr: string[] = []
  if (typeof payload.amr === 'string') {
    amr = [payload.amr]
  } else if (Array.isArray(payload.amr)) {
    amr = payload.amr.filter((v): v is string => typeof v === 'string')
  }

  // Determine if MFA was used:
  // - Both acr and amr must be present
  // - amr must have multiple methods OR contain a standard MFA indicator
  const hasMultipleMethods = amr.length > 1
  const hasMfaIndicator = amr.some(method => MFA_INDICATORS.has(method))
  const hasMfa = Boolean(acr && amr.length > 0 && (hasMultipleMethods || hasMfaIndicator))

  return {
    hasMfa,
    acr,
    amr,
    authTime,
  }
}
