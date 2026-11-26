import type { AuthorizeRequest, OidcClaims, OidcProvider } from './oidc.js'

/** In-memory OIDC provider for tests: returns canned claims and records what it was asked. */
export function createFakeOidcProvider(opts: {
  claims: Omit<OidcClaims, 'authTime'> & { authTime?: number }
  logoutUrl?: string | null
}) {
  let completeError: Error | undefined
  const fake = {
    lastBegin: undefined as AuthorizeRequest | undefined,
    lastComplete: undefined as { code: string; codeVerifier: string; nonce: string } | undefined,
    failCompleteWith(e: Error) {
      completeError = e
    },
    async beginLogin(req: AuthorizeRequest) {
      fake.lastBegin = req
      return `https://idp.test/authorize?state=${encodeURIComponent(req.state)}`
    },
    async completeLogin(req: { code: string; codeVerifier: string; nonce: string }) {
      fake.lastComplete = req
      if (completeError) throw completeError
      return opts.claims
    },
    async logoutUrl() {
      return opts.logoutUrl ?? null
    },
    async verifyJwt(): Promise<Record<string, unknown>> {
      throw new Error('fake OIDC provider verifies no JWTs')
    },
  } satisfies OidcProvider & Record<string, unknown>
  return fake
}
