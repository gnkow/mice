import { SignJWT, jwtVerify } from 'jose'
import type { Clock } from '../../../shared/index.js'
import type { TestUserSpec } from './idpAdapter.js'
import { buildTestIdTokenClaims, type TestIdTokenUser } from './testIdTokenClaims.js'

export type FakeIdpUser = TestIdTokenUser

export interface FakeIdpClaims {
  sub: string
  email: string
  name?: string
  iss: string
  aud: string
  iat: number
  exp: number
  amr?: string[]
  acr?: string
  guest?: boolean
  auth_time?: number
}

export interface FakeIdp {
  issueToken(sub: string, opts?: { authAgeSec?: number }): Promise<string>
  decodeToken(token: string): Promise<FakeIdpClaims>
}

const SECRET_KEY = new TextEncoder().encode('test-secret-key-for-fake-idp-do-not-use-in-prod')

/**
 * Thin HS256 adapter over {@link buildTestIdTokenClaims} for AuthTestApp’s in-process BFF.
 * Guest / MFA / missing-name claims share locality with {@link createFakeIdpAdapter}.
 */
export function createFakeIdp(users: Array<TestUserSpec & { sub: string }>, clock: Clock): FakeIdp {
  const userMap = new Map(users.map((u) => [u.sub, { ...u, sub: u.sub }]))
  const issuer = 'https://test-idp.example.com'
  const audience = 'test-audience'

  return {
    async issueToken(sub: string, opts?: { authAgeSec?: number }): Promise<string> {
      const user = userMap.get(sub)
      if (!user) throw new Error(`User ${sub} not found`)
      if (user.disabled) throw new Error(`User ${sub} is disabled`)

      const now = Math.floor(clock.now() / 1000)
      const claims = buildTestIdTokenClaims(user, { nowSec: now, authAgeSec: opts?.authAgeSec })

      return new SignJWT(claims)
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuer(issuer)
        .setAudience(audience)
        .setSubject(user.sub)
        .setIssuedAt(now)
        .setExpirationTime(now + 3600)
        .sign(SECRET_KEY)
    },

    async decodeToken(token: string): Promise<FakeIdpClaims> {
      const { payload } = await jwtVerify(token, SECRET_KEY, {
        issuer,
        audience,
        clockTolerance: 100 * 365 * 24 * 60 * 60,
      })

      return {
        sub: payload.sub as string,
        email: payload.email as string,
        ...(typeof payload.name === 'string' ? { name: payload.name } : {}),
        iss: payload.iss as string,
        aud: payload.aud as string,
        iat: payload.iat as number,
        exp: payload.exp as number,
        ...(Array.isArray(payload.amr) ? { amr: payload.amr as string[] } : {}),
        ...(typeof payload.acr === 'string' ? { acr: payload.acr } : {}),
        ...(payload.guest === true ? { guest: true } : {}),
        ...(typeof payload.auth_time === 'number' ? { auth_time: payload.auth_time } : {}),
      }
    },
  }
}
