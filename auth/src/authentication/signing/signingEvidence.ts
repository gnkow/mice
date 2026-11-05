import { decodeProtectedHeader } from 'jose'
import { extractMfaEvidence } from './mfaEvidence.js'
import type { MfaEvidence, VerificationMetadata } from './signingCeremony.js'

export type SigningEvidenceResult =
  | { ok: true; mfaEvidence: MfaEvidence; verificationMetadata: VerificationMetadata }
  | { ok: false; reason: 'unverifiable' | 'auth_time_missing' | 'auth_time_stale' | 'acr_missing' | 'amr_missing' | 'weak_mfa'; detail?: string }

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

  const authTime = payload.auth_time
  if (typeof authTime !== 'number') return { ok: false, reason: 'auth_time_missing' }
  if (deps.nowSec - authTime > deps.maxAgeSec) return { ok: false, reason: 'auth_time_stale' }

  const evidence = extractMfaEvidence(payload)
  if (!evidence.acr) return { ok: false, reason: 'acr_missing' }
  if (evidence.amr.length === 0) return { ok: false, reason: 'amr_missing' }
  if (!evidence.hasMfa) return { ok: false, reason: 'weak_mfa' }

  return {
    ok: true,
    mfaEvidence: { acr: evidence.acr, amr: evidence.amr, auth_time: authTime },
    verificationMetadata: {
      jwks_key_id: kid,
      token_verified_at: deps.nowSec * 1000,
      idp_issuer: iss,
      ...(typeof payload.sid === 'string' ? { idp_session_id: payload.sid } : {}),
      ...(typeof payload.jti === 'string' ? { token_id: payload.jti } : {}),
    },
  }
}
