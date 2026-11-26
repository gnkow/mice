import { jwtVerify, decodeProtectedHeader } from 'jose'
import type { VerificationMetadata, MfaEvidence } from '../signing/signingCeremony.js'
import { assembleSignatureEvidence } from '../signing/signingCeremony.js'
import { decodeJwtPayload } from './oidcClaims.js'

/**
 * Token Verification Metadata Extraction (Ticket 26, U19)
 *
 * Extracts cryptographic verification metadata from id_token to prove
 * Mice validated the IdP's assertion (Part 11 §11.200 evidence requirements).
 *
 * Related:
 * - .scratch/authentication/issues/26-signature-evidence-metadata.md
 * - Round 8 decision U19
 * - Part 11 §11.200 (two distinct identification components)
 */

export interface TokenVerificationResult {
  /** MFA evidence extracted from claims (signature-record shape) */
  mfaEvidence: MfaEvidence
  /** Verification metadata proving cryptographic validation */
  verificationMetadata: VerificationMetadata
}

/**
 * Extract MFA evidence and verification metadata from id_token.
 * Throws if token verification fails or required fields missing.
 */
export async function extractTokenEvidence(
  idToken: string,
  keySet: Parameters<typeof jwtVerify>[1],
  options: Parameters<typeof jwtVerify>[2]
): Promise<TokenVerificationResult> {
  const protectedHeader = decodeProtectedHeader(idToken)
  const kid = protectedHeader.kid

  if (!kid || typeof kid !== 'string') {
    throw new Error('id_token missing kid (key ID) in protected header')
  }

  const verificationTimestamp = Date.now()
  await jwtVerify(idToken, keySet, options)
  const claims = decodeJwtPayload(idToken)
  return assembleSignatureEvidence(claims, {
    jwksKeyId: kid,
    verifiedAtMs: verificationTimestamp,
  })
}

/**
 * Extract verification metadata only (without full verification).
 * Assumes the token was already verified by the caller.
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
  return assembleSignatureEvidence(payload, {
    jwksKeyId: kid,
    verifiedAtMs: verifiedAt,
  }).verificationMetadata
}
