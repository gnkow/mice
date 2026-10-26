/**
 * Adapter interface for a test IdP (seam 3). The in-process `createFakeIdp` implements it today; a container
 * adapter over the Keycloak realms in `auth/keycloak/` (realm-mice.json) would implement the same interface by
 * driving the realm's login form in `signIn`, and `idpAdapter.contract.test.ts` would run against both.
 */
export type TestUserSpec = {
  /** The `sub` claim; defaults to the user key. */
  sub?: string
  email: string
  /** The `name` claim; `null` omits it (a missing name claim). Defaults to the user key. */
  name?: string | null
  emailVerified?: boolean
  groups?: string[]
  /** An external guest: an account outside the home domain, carrying `guest: true`. */
  guest?: boolean
  /** Authenticated with a second factor: `amr` is [pwd, otp] and `acr` is `mfa`; otherwise [pwd] and `pwd`. */
  mfa?: boolean
  /** A disabled account: the IdP refuses to sign it in. */
  disabled?: boolean
}

export type SignInOptions = {
  /** Seconds before IdP-now at which the user authenticated (`auth_time`); defaults to 0. */
  authAgeSec?: number
}

export type SignInResult =
  | { ok: true; code: string; state: string }
  | { ok: false; error: string; state: string }

export interface IdpAdapter {
  readonly issuer: string
  readonly clientId: string
  start(): Promise<void>
  stop(): Promise<void>
  /** Registers or replaces a user under `key`. */
  addUser(key: string, spec: TestUserSpec): void
  /** Plays the browser: signs `key` in at the IdP behind `authorizeUrl` and returns the callback parameters. */
  signIn(key: string, authorizeUrl: string, opts?: SignInOptions): Promise<SignInResult>
}
