export type EvidenceRow = { label: string; value: string }

type Detail = Record<string, unknown> | undefined

const iso = (n: unknown, unit: 'sec' | 'ms') =>
  typeof n === 'number' ? new Date(unit === 'sec' ? n * 1000 : n).toISOString() : undefined

/** Labelled MFA and token-verification evidence stored on an `esign.created` audit event. */
export function signatureEvidenceRows(action: string, detail: Detail): EvidenceRow[] {
  if (action !== 'esign.created' || !detail) return []
  const mfa = (detail.mfaEvidence ?? {}) as Record<string, unknown>
  const ver = (detail.verificationMetadata ?? {}) as Record<string, unknown>
  const rows: [string, string | undefined][] = [
    ['Auth context (acr)', typeof mfa.acr === 'string' ? mfa.acr : undefined],
    ['Auth methods (amr)', Array.isArray(mfa.amr) ? mfa.amr.join(', ') : undefined],
    ['Authenticated at', iso(mfa.auth_time, 'sec')],
    ['JWKS key id', typeof ver.jwks_key_id === 'string' ? ver.jwks_key_id : undefined],
    ['Verified at', iso(ver.token_verified_at, 'ms')],
    ['Issuer', typeof ver.idp_issuer === 'string' ? ver.idp_issuer : undefined],
  ]
  return rows.flatMap(([label, value]) => (value ? [{ label, value }] : []))
}
