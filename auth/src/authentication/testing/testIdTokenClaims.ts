import type { TestUserSpec } from './idpAdapter.js'

/** A registered test user with a concrete `sub` (adapter key default applied). */
export type TestIdTokenUser = TestUserSpec & { sub: string }

export type BuildTestIdTokenClaimsOpts = {
  nowSec: number
  /** Seconds before `nowSec` for `auth_time` (defaults to 0). */
  authAgeSec?: number
  nonce?: string | null
}

/**
 * Deep claim builder for the test IdP harness: guest / MFA / missing-name live here once.
 * Adapters only choose how to sign and deliver the token.
 */
export function buildTestIdTokenClaims(
  user: TestIdTokenUser,
  opts: BuildTestIdTokenClaimsOpts,
): Record<string, unknown> {
  const claims: Record<string, unknown> = {
    email: user.email,
    auth_time: opts.nowSec - (opts.authAgeSec ?? 0),
    amr: user.mfa ? ['pwd', 'otp'] : ['pwd'],
    acr: user.mfa ? 'mfa' : 'pwd',
    email_verified: user.emailVerified !== false,
  }
  if (opts.nonce != null) claims.nonce = opts.nonce
  if (user.name !== null) claims.name = user.name ?? user.sub
  if (user.groups) claims.groups = user.groups
  if (user.guest) claims.guest = true
  return claims
}
