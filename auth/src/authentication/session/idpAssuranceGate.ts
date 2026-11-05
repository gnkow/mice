/** Claims the IdP must be able to assert for e-signature step-up (spec 04: acr/amr/auth_time). */
const REQUIRED_CLAIMS = ['acr', 'amr', 'auth_time'] as const

/** Returns one problem per required claim the IdP discovery document does not advertise. */
export function idpAssuranceProblems(doc: { claims_supported?: string[] }): string[] {
  const supported = new Set(doc.claims_supported ?? [])
  return REQUIRED_CLAIMS.filter((c) => !supported.has(c)).map(
    (c) => `IdP does not advertise the "${c}" claim in claims_supported; signing step-up cannot be verified`,
  )
}

/** Refuses to start when the IdP cannot assert acr, amr and auth_time, or cannot be reached. */
export async function assertIdpAssurance(
  issuer: string,
  doFetch: typeof fetch = fetch,
): Promise<void> {
  const res = await doFetch(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`)
  if (!res.ok) throw new Error(`Refusing to start: IdP discovery failed: ${res.status}`)
  const problems = idpAssuranceProblems((await res.json()) as { claims_supported?: string[] })
  if (problems.length) throw new Error(`Refusing to start:\n- ${problems.join('\n- ')}`)
}
