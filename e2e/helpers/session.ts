import type { Page } from '@playwright/test'

const BASE_URL = process.env.MICE_BASE_URL ?? 'http://localhost:5173'
const AUTH_URL = process.env.AUTH_URL ?? 'http://localhost:8080'

export type TestIdentity = {
  name: string
  email: string
  sub: string
  iss?: string
  groups?: string[]
  /**
   * Formal RBAC role. Defaults to manager (namespace:create + data access).
   * Pair with instanceAdmin for suite cleanup of /auth/instance.
   */
  role?: 'external' | 'user' | 'manager' | 'auditor' | 'admin'
  instanceAdmin?: boolean
}

export type MintedSession = {
  identity: TestIdentity
  cookieName: string
  cookieValue: string
}

/**
 * Mint an opaque server-side Session via AUTH_DEV_MODE POST /auth/dev/session.
 * Replaces the old local EncryptJWT cookie that no longer matches cookieSeal + webSessions.
 */
export async function sealTestSession(user: TestIdentity): Promise<string> {
  const minted = await mintSessionCookie(user)
  return minted.cookieValue
}

export async function mintSessionCookie(
  identity: Partial<TestIdentity> = {},
): Promise<MintedSession> {
  const groups = identity.groups
    ?.map((g) => g.trim().toLowerCase())
    .filter(Boolean)
  const user: TestIdentity = {
    name: identity.name ?? 'Mice E2E',
    email: identity.email ?? 'e2e@mice.local',
    sub: identity.sub ?? 'e2e-user',
    iss: identity.iss ?? 'mice-e2e',
    role: identity.role ?? 'manager',
    // Suite cleanup needs /auth/instance; Manager alone is not enough.
    instanceAdmin: identity.instanceAdmin ?? (identity.role == null || identity.role === 'manager'),
    ...(groups?.length ? { groups } : {}),
  }
  const res = await fetch(`${AUTH_URL}/auth/dev/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-mice-reason': 'e2e: mint session' },
    body: JSON.stringify({
      sub: user.sub,
      iss: user.iss,
      email: user.email,
      name: user.name,
      emailVerified: true,
      role: user.role,
      ...(user.instanceAdmin !== undefined ? { instanceAdmin: user.instanceAdmin } : {}),
      ...(user.groups?.length ? { groups: user.groups } : {}),
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`mintSession failed ${res.status}: ${text}`)
  }
  const body = (await res.json()) as { cookieName: string; cookieValue: string }
  if (!body.cookieName || !body.cookieValue) {
    throw new Error('mintSession response missing cookieName/cookieValue')
  }
  return { identity: user, cookieName: body.cookieName, cookieValue: body.cookieValue }
}

/**
 * Establish a BFF session for Playwright by minting a server-side Session
 * (Compose AUTH_DEV_MODE). Prefer Keycloak SSO for real IdP paths.
 */
export async function mintSession(
  page: Page,
  identity: Partial<TestIdentity> = {},
): Promise<TestIdentity> {
  const minted = await mintSessionCookie(identity)
  const url = new URL(BASE_URL)
  const hostPrefixed = minted.cookieName.startsWith('__Host-')
  await page.context().addCookies([
    hostPrefixed
      ? {
          name: minted.cookieName,
          value: minted.cookieValue,
          url: BASE_URL,
          httpOnly: true,
          sameSite: 'Lax' as const,
          secure: true,
        }
      : {
          name: minted.cookieName,
          value: minted.cookieValue,
          domain: url.hostname,
          path: '/',
          httpOnly: true,
          sameSite: 'Lax' as const,
          secure: false,
        },
  ])
  return minted.identity
}
