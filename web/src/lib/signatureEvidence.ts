export type EvidenceRow = { label: string; value: string }

type Detail = Record<string, unknown> | undefined

const iso = (n: unknown, unit: 'sec' | 'ms') =>
  typeof n === 'number' ? new Date(unit === 'sec' ? n * 1000 : n).toISOString() : undefined

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined
}

/**
 * Labelled MFA, token-verification, and signature-identity evidence on an
 * `esign.created` audit event (Tickets 13 + 53).
 */
export function signatureEvidenceRows(action: string, detail: Detail): EvidenceRow[] {
  if (action !== 'esign.created' || !detail) return []

  const signer =
    detail.signer && typeof detail.signer === 'object'
      ? (detail.signer as Record<string, unknown>)
      : undefined
  const mfa = (detail.mfaEvidence ?? {}) as Record<string, unknown>
  const ver = (detail.verificationMetadata ?? {}) as Record<string, unknown>

  const identity: [string, string | undefined][] = [
    ['Signed name', str(signer?.name)],
    ['Issuer (iss)', str(signer?.iss)],
    ['Subject (sub)', str(signer?.sub)],
    [
      'Signed at',
      str(detail.signedAt) ??
        (typeof detail.signedAt === 'number'
          ? new Date(detail.signedAt).toISOString()
          : undefined),
    ],
    ['Now known as', str(detail.nowKnownAs)],
  ]

  const evidence: [string, string | undefined][] = [
    ['Auth context (acr)', typeof mfa.acr === 'string' ? mfa.acr : undefined],
    ['Auth methods (amr)', Array.isArray(mfa.amr) ? mfa.amr.join(', ') : undefined],
    ['Authenticated at', iso(mfa.auth_time, 'sec')],
    ['JWKS key id', typeof ver.jwks_key_id === 'string' ? ver.jwks_key_id : undefined],
    ['Verified at', iso(ver.token_verified_at, 'ms')],
    ['Issuer', typeof ver.idp_issuer === 'string' ? ver.idp_issuer : undefined],
  ]

  return [...identity, ...evidence].flatMap(([label, value]) =>
    value ? [{ label, value }] : [],
  )
}
