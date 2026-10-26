import { createHash } from 'node:crypto'
import { EncryptJWT } from 'jose'
import type { Page } from '@playwright/test'

const BASE_URL = process.env.MICE_BASE_URL ?? 'http://localhost:5173'
const SESSION_SECRET =
  process.env.SESSION_SECRET ?? 'dev-only-change-me-mice-session-secret'
const COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? 'mice_session'
const TTL_SEC = Number(process.env.SESSION_TTL_SEC ?? 60 * 60 * 8)

export type TestIdentity = {
  name: string
  email: string
  sub: string
  iss?: string
  groups?: string[]
}

function secretKey() {
  return createHash('sha256').update(SESSION_SECRET).digest()
}

/** Seal a BFF session cookie (same format as auth/src/authentication/session/session.ts). */
export async function sealTestSession(user: TestIdentity): Promise<string> {
  return new EncryptJWT({
    sub: user.sub,
    iss: user.iss ?? 'mice-e2e',
    email: user.email,
    email_verified: true,
    name: user.name,
    id_token: '',
    groups: user.groups ?? [],
  })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setExpirationTime(`${TTL_SEC}s`)
    .encrypt(secretKey())
}

/**
 * Establish a BFF session for Playwright by sealing a cookie with the
 * local SESSION_SECRET (Compose default). Prefer Keycloak SSO for real IdP paths.
 */
export async function mintSession(
  page: Page,
  identity: Partial<TestIdentity> = {},
): Promise<TestIdentity> {
  const groups = identity.groups
    ?.map((g) => g.trim().toLowerCase())
    .filter(Boolean)
  const user: TestIdentity = {
    name: identity.name ?? 'Mice E2E',
    email: identity.email ?? 'e2e@mice.local',
    sub: identity.sub ?? 'e2e-user',
    iss: identity.iss ?? 'mice-e2e',
    ...(groups?.length ? { groups } : {}),
  }
  const token = await sealTestSession(user)
  const url = new URL(BASE_URL)
  await page.context().addCookies([
    {
      name: COOKIE_NAME,
      value: token,
      domain: url.hostname,
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      secure: false,
    },
  ])
  return user
}
