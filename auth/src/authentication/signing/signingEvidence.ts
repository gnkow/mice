import { decodeProtectedHeader } from 'jose'
import { extractMfaEvidence } from './mfaEvidence.js'
import {
  assembleSignatureEvidence,
  type MfaEvidence,
  type VerificationMetadata,
} from './signingCeremony.js'

export type SigningEvidenceRefusalReason =
  | 'unverifiable'
  | 'auth_time_missing'
  | 'auth_time_stale'
  | 'acr_missing'
  | 'amr_missing'
  | 'weak_mfa'

export type SigningEvidenceResult =
  | { ok: true; mfaEvidence: MfaEvidence; verificationMetadata: VerificationMetadata }
  | { ok: false; reason: SigningEvidenceRefusalReason; detail?: string }

export type SigningEvidenceAge = { nowSec: number; maxAgeSec: number }

/**
 * Completeness of signing claims after JWT verification (Ticket 52).
 * Missing or stale claims refuse; nothing defaults. Callers assemble stored
 * evidence only when this returns ok (coordinates with assembleSignatureEvidence).
 */
export function assessSigningEvidenceCompleteness(
  payload: Record<string, unknown>,
  age: SigningEvidenceAge,
): { ok: true } | { ok: false; reason: Exclude<SigningEvidenceRefusalReason, 'unverifiable'> } {
  const authTime = payload.auth_time
  if (typeof authTime !== 'number') return { ok: false, reason: 'auth_time_missing' }
  if (age.nowSec - authTime > age.maxAgeSec) return { ok: false, reason: 'auth_time_stale' }

  const evidence = extractMfaEvidence(payload)
  if (!evidence.acr) return { ok: false, reason: 'acr_missing' }
  if (evidence.amr.length === 0) return { ok: false, reason: 'amr_missing' }
  if (!evidence.hasMfa) return { ok: false, reason: 'weak_mfa' }
  return { ok: true }
}

/**
 * Re-verifies the step-up ID token at signing time and demands complete, fresh, qualifying
 * claims. A missing or stale claim refuses the signature; nothing defaults.
 */
export async function verifySigningEvidence(
  idToken: string,
  deps: { verifyJwt: (token: string) => Promise<Record<string, unknown>>; nowSec: number; maxAgeSec: number },
): Promise<SigningEvidenceResult> {
  let payload: Record<string, unknown>
  let kid: string | undefined
  try {
    payload = await deps.verifyJwt(idToken)
    kid = decodeProtectedHeader(idToken).kid
  } catch (e) {
    return { ok: false, reason: 'unverifiable', detail: e instanceof Error ? e.message : String(e) }
  }
  if (!kid) return { ok: false, reason: 'unverifiable', detail: 'id_token has no kid' }
  const iss = payload.iss
  if (typeof iss !== 'string' || !iss) return { ok: false, reason: 'unverifiable', detail: 'id_token has no iss' }

  const completeness = assessSigningEvidenceCompleteness(payload, {
    nowSec: deps.nowSec,
    maxAgeSec: deps.maxAgeSec,
  })
  if (!completeness.ok) return completeness

  const assembled = assembleSignatureEvidence(payload, {
    jwksKeyId: kid,
    verifiedAtMs: deps.nowSec * 1000,
  })
  return { ok: true, ...assembled }
}
