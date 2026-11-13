/** Claims the IdP must be able to assert for e-signature step-up (spec 04: acr/amr/auth_time). */
const REQUIRED_CLAIMS = ['acr', 'amr', 'auth_time'] as const

export type IdpAssuranceAssessment = { ok: true } | { ok: false; problems: string[] }

function claimsSupportedSet(doc: { claims_supported?: unknown }): Set<string> {
  const raw = doc.claims_supported
  if (!Array.isArray(raw)) return new Set()
  return new Set(raw.filter((c): c is string => typeof c === 'string'))
}

/** Returns one problem per required claim the IdP discovery document does not advertise. */
export function idpAssuranceProblems(doc: { claims_supported?: unknown }): string[] {
  const supported = claimsSupportedSet(doc)
  return REQUIRED_CLAIMS.filter((c) => !supported.has(c)).map(
    (c) => `IdP does not advertise the "${c}" claim in claims_supported; signing step-up cannot be verified`,
  )
}

/**
 * Discovery fetch + required-claim check for signing step-up.
 * One assessment covers unreachable discovery and missing acr/amr/auth_time.
 */
export async function assessIdpAssurance(
  issuer: string,
  doFetch: typeof fetch = fetch,
): Promise<IdpAssuranceAssessment> {
  const res = await doFetch(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`)
  if (!res.ok) {
    return { ok: false, problems: [`IdP discovery failed: ${res.status}`] }
  }
  const problems = idpAssuranceProblems((await res.json()) as { claims_supported?: unknown })
  return problems.length ? { ok: false, problems } : { ok: true }
}

/** Refuses to start when the IdP cannot assert acr, amr and auth_time, or cannot be reached. */
export async function assertIdpAssurance(
  issuer: string,
  doFetch: typeof fetch = fetch,
): Promise<void> {
  const assessment = await assessIdpAssurance(issuer, doFetch)
  if (!assessment.ok) {
    throw new Error(`Refusing to start:\n- ${assessment.problems.join('\n- ')}`)
  }
}
