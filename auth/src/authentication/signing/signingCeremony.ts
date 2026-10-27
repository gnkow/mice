import { createHash } from 'node:crypto'
import { requireSigningCapability, type PrincipalId } from '../commits/commitIdentity.js'

/**
 * Signing Ceremony - Authentication Domain
 * 
 * Provides the authentication-layer primitives for electronic signatures:
 * - Fresh authentication validation
 * - MFA requirement enforcement
 * - Content hash computation
 * - Tamper detection
 * 
 * This module contains ONLY authentication concerns. The GxP compliance-specific
 * signature ceremony (merge approval workflow, signature storage in immudb, 
 * self-approval prevention) is owned by 04-gxp-compliance.
 * 
 * Related specs:
 * - 01-authentication: Step-up re-authentication (user story #9)
 * - 04-gxp-compliance: E-signature ceremony for merge approval
 */

const SIGNATURE_FRESHNESS_MS = 5 * 60 * 1000 // 5 minutes

export type SignatureMeaning = 'Authored' | 'Reviewed' | 'Approved'

/**
 * MFA Evidence from IdP (Ticket 26, U19)
 * 
 * Extracted from id_token at signing ceremony. Stored to prove
 * MFA was used and that Mice verified the IdP's assertion.
 */
export interface MfaEvidence {
  /** Authentication Context Class Reference (e.g., "mfa", "urn:mace:incommon:iap:silver") */
  acr?: string
  /** Authentication Methods References (e.g., ["pwd", "otp"]) */
  amr: string[]
  /** Epoch seconds when user authenticated at IdP */
  auth_time?: number
}

/**
 * Token Verification Metadata (Ticket 26, U19)
 * 
 * Proves Mice performed cryptographic verification of IdP assertion,
 * not just copying claims blindly (Part 11 §11.200 evidence).
 */
export interface VerificationMetadata {
  /** JWKS key ID used to verify id_token signature */
  jwks_key_id: string
  /** When Mice verified the token */
  token_verified_at: number
  /** IdP issuer (iss claim) */
  idp_issuer: string
}

export interface SignatureRecord {
  /** Cryptographic hash of the signed content */
  hash: string
  /** The principal who signed */
  principal: PrincipalId & { name: string }
  /** When the signature was created */
  signedAt: number
  /** What the signature means */
  meaning: SignatureMeaning
  /** The exact content that was signed */
  content: string
  /** MFA evidence from IdP (Ticket 26) */
  mfaEvidence?: MfaEvidence
  /** Token verification metadata (Ticket 26) */
  verificationMetadata?: VerificationMetadata
}

export interface SessionInfo {
  /** When the user last authenticated */
  authenticatedAt: number
  /** Whether MFA was used */
  mfaVerified: boolean
  /** Principal information */
  principal: PrincipalId & { name: string }
  /** MFA evidence from IdP (Ticket 26) */
  mfaEvidence?: MfaEvidence
  /** Token verification metadata (Ticket 26) */
  verificationMetadata?: VerificationMetadata
}

/**
 * Check if authentication is fresh enough for signing (<5 minutes).
 */
export function isAuthenticationFresh(authenticatedAt: number, now: number = Date.now()): boolean {
  return now - authenticatedAt < SIGNATURE_FRESHNESS_MS
}

/**
 * Validate that session meets requirements for electronic signature.
 */
export function validateSigningSession(session: SessionInfo, now: number = Date.now()): void {
  if (!isAuthenticationFresh(session.authenticatedAt, now)) {
    throw new Error('Authentication too old for signing; re-authenticate within last 5 minutes')
  }
  
  if (!session.mfaVerified) {
    throw new Error('MFA required for electronic signature')
  }
  
  requireSigningCapability(session.principal)
}

/**
 * Compute SHA-256 hash of content being signed.
 */
export function computeContentHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

/**
 * Create an electronic signature record.
 */
export function createSignature(
  content: string,
  meaning: SignatureMeaning,
  session: SessionInfo,
  now: number = Date.now(),
): SignatureRecord {
  validateSigningSession(session, now)
  
  const hash = computeContentHash(content)
  
  return {
    hash,
    principal: session.principal,
    signedAt: now,
    meaning,
    content,
    ...(session.mfaEvidence ? { mfaEvidence: session.mfaEvidence } : {}),
    ...(session.verificationMetadata ? { verificationMetadata: session.verificationMetadata } : {}),
  }
}

/**
 * Verify that a signature's hash matches the current content.
 * Returns true if content has not been tampered with.
 */
export function verifySignatureHash(signature: SignatureRecord, currentContent: string): boolean {
  const currentHash = computeContentHash(currentContent)
  return signature.hash === currentHash
}

/**
 * Format signature for display/audit trail.
 */
export function formatSignature(signature: SignatureRecord): string {
  const date = new Date(signature.signedAt).toISOString()
  const { principal, meaning, hash } = signature
  return `${meaning}-by: ${principal.iss}|${principal.sub} (${principal.name}) at ${date}\nHash: ${hash}`
}

/**
 * Prepare content for signing ceremony display.
 * Returns the content and its hash for user verification before signing.
 */
export function prepareForSigning(content: string): { content: string; hash: string } {
  return {
    content,
    hash: computeContentHash(content),
  }
}
