export type EvidenceRow = { label: string; value: string }

export type EvidenceSection = {
  id: 'identity' | 'verification'
  heading: string
  rows: EvidenceRow[]
}

type Detail = Record<string, unknown> | undefined

const iso = (n: unknown, unit: 'sec' | 'ms') =>
  typeof n === 'number' ? new Date(unit === 'sec' ? n * 1000 : n).toISOString() : undefined

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined
}

function rowsFromPairs(pairs: [string, string | undefined][]): EvidenceRow[] {
  return pairs.flatMap(([label, value]) => (value ? [{ label, value }] : []))
}

const SIGNATURE_EVIDENCE_ACTIONS = new Set(['esign.created', 'signature.created'])

function hasCeremonyEvidence(detail: Record<string, unknown>): boolean {
  return Boolean(
    detail.mfaEvidence ||
      detail.verificationMetadata ||
      detail.signer ||
      detail.signatureId ||
      detail.signedAt,
  )
}

/**
 * Grouped MFA, token-verification, and signature-identity evidence.
 * Shown on legacy `esign.created` rows and on mutation rows that carry ceremony
 * evidence in `detail` (Tickets 13, 26, 53 / #83; #87 Phase 3 same-row).
 * Identity vs IdP verification stay separate so Auditors scan each claim set.
 */
export function signatureEvidenceSections(action: string, detail: Detail): EvidenceSection[] {
  if (!detail) return []
  if (!SIGNATURE_EVIDENCE_ACTIONS.has(action) && !hasCeremonyEvidence(detail)) return []

  const signer =
    detail.signer && typeof detail.signer === 'object'
      ? (detail.signer as Record<string, unknown>)
      : undefined
  const mfa = (detail.mfaEvidence ?? {}) as Record<string, unknown>
  const ver = (detail.verificationMetadata ?? {}) as Record<string, unknown>

  const identity = rowsFromPairs([
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
  ])

  const verification = rowsFromPairs([
    ['Auth context (acr)', typeof mfa.acr === 'string' ? mfa.acr : undefined],
    ['Auth methods (amr)', Array.isArray(mfa.amr) ? mfa.amr.join(', ') : undefined],
    ['Authenticated at', iso(mfa.auth_time, 'sec')],
    ['JWKS key id', typeof ver.jwks_key_id === 'string' ? ver.jwks_key_id : undefined],
    ['Verified at', iso(ver.token_verified_at, 'ms')],
    ['Issuer', typeof ver.idp_issuer === 'string' ? ver.idp_issuer : undefined],
  ])

  return [
    ...(identity.length ? [{ id: 'identity' as const, heading: 'Signer identity', rows: identity }] : []),
    ...(verification.length
      ? [{ id: 'verification' as const, heading: 'IdP verification', rows: verification }]
      : []),
  ]
}

/**
 * Flat labelled rows for callers that do not need section headings.
 */
export function signatureEvidenceRows(action: string, detail: Detail): EvidenceRow[] {
  return signatureEvidenceSections(action, detail).flatMap((s) => s.rows)
}
