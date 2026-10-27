import { jwtVerify, decodeProtectedHeader } from 'jose'
import type { VerificationMetadata, MfaEvidence } from '../signing/signingCeremony.js'
import { extractMfaEvidence } from '../signing/mfaEvidence.js'
import { decodeJwtPayload } from './oidcClaims.js'

/**
 * Token Verification Metadata Extraction (Ticket 26, U19)
 * 
 * Extracts cryptographic verification metadata from id_token to prove
 * Mice validated the IdP's assertion (Part 11 §11.200 evidence requirements).
 * 
 * Stores:
 * - JWKS key ID (kid) used to verify signature
 * - Verification timestamp (when Mice verified it)
 * - IdP issuer (iss claim)
 * 
 * This proves we didn't just copy claims blindly - we performed
 * cryptographic verification of the IdP's signed assertion.
 * 
 * Related:
 * - .scratch/authentication/issues/26-signature-evidence-metadata.md
 * - Round 8 decision U19
 * - Part 11 §11.200 (two distinct identification components)
 */

export interface TokenVerificationResult {
  /** MFA evidence extracted from claims */
  mfaEvidence: MfaEvidence
  /** Verification metadata proving cryptographic validation */
  verificationMetadata: VerificationMetadata
}

/**
 * Extract MFA evidence and verification metadata from id_token.
 * 
 * Returns both:
 * - MFA evidence (acr, amr, auth_time) from claims
 * - Verification metadata (kid, verification time, issuer)
 * 
 * Throws if token verification fails or required fields missing.
 */
export async function extractTokenEvidence(
  idToken: string,
  keySet: Parameters<typeof jwtVerify>[1],
  options: Parameters<typeof jwtVerify>[2]
): Promise<TokenVerificationResult> {
  // Extract kid from protected header BEFORE verification
  // (kid tells us which public key to use)
  const protectedHeader = decodeProtectedHeader(idToken)
  const kid = protectedHeader.kid
  
  if (!kid || typeof kid !== 'string') {
    throw new Error('id_token missing kid (key ID) in protected header')
  }
  
  // Perform cryptographic verification
  const verificationTimestamp = Date.now()
  const { payload } = await jwtVerify(idToken, keySet, options)
  
  // Extract issuer from verified payload
  const iss = payload.iss
  if (!iss || typeof iss !== 'string') {
    throw new Error('id_token missing iss (issuer) claim')
  }
  
  // Extract MFA evidence from verified claims
  const claims = decodeJwtPayload(idToken)
  const mfaEvidence = extractMfaEvidence(claims)
  
  // Build verification metadata
  const verificationMetadata: VerificationMetadata = {
    jwks_key_id: kid,
    token_verified_at: verificationTimestamp,
    idp_issuer: iss,
  }
  
  return {
    mfaEvidence,
    verificationMetadata,
  }
}

/**
 * Extract verification metadata only (without full verification).
 * 
 * Used when we've already verified the token but need to extract metadata
 * for storage. Does NOT perform cryptographic verification - assumes
 * token was already verified by caller.
 */
export function extractVerificationMetadata(
  idToken: string,
  verifiedAt: number = Date.now()
): VerificationMetadata {
  const protectedHeader = decodeProtectedHeader(idToken)
  const kid = protectedHeader.kid
  
  if (!kid || typeof kid !== 'string') {
    throw new Error('id_token missing kid (key ID) in protected header')
  }
  
  const payload = decodeJwtPayload(idToken)
  const iss = payload.iss
  
  if (!iss || typeof iss !== 'string') {
    throw new Error('id_token missing iss (issuer) claim')
  }
  
  return {
    jwks_key_id: kid,
    token_verified_at: verifiedAt,
    idp_issuer: iss,
  }
}
