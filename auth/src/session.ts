import { createHash } from 'node:crypto'
import { EncryptJWT, jwtDecrypt } from 'jose'
import type { Context } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { env } from './env.js'

export type PatScope = {
  namespace: string
  /** Omit = all repos in namespace. */
  repo?: string
  maxRole: 'read' | 'triage' | 'write' | 'maintain' | 'admin'
}

export type SessionUser = {
  sub: string
  iss: string
  email: string
  name: string
  /** OIDC id_token for RP-initiated logout (optional). */
  idToken?: string
  /** IdP groups / roles claims (optional; used by AUTHZ_GROUP_BOOTSTRAP). */
  groups?: string[]
  /**
   * Fine-grained PAT resource scopes (Phase 2). Empty/undefined = full user
   * effective access. Never exceeds the user's grants.
   */
  patScopes?: PatScope[]
}

function secretKey() {
  return createHash('sha256').update(env.sessionSecret).digest()
}

export async function sealSession(user: SessionUser): Promise<string> {
  return new EncryptJWT({
    sub: user.sub,
    iss: user.iss,
    email: user.email,
    name: user.name,
    id_token: user.idToken ?? '',
    groups: user.groups ?? [],
  })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setExpirationTime(`${env.sessionTtlSec}s`)
    .encrypt(secretKey())
}

export async function openSession(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtDecrypt(token, secretKey())
    const sub = String(payload.sub ?? '')
    const iss = String(payload.iss ?? '')
    const email = String(payload.email ?? '')
    const name = String(payload.name ?? '')
    const idToken = String(payload.id_token ?? '')
    if (!sub || !iss || !email || !name) return null
    const groupsRaw = payload.groups
    const groups = Array.isArray(groupsRaw)
      ? groupsRaw
          .filter((g): g is string => typeof g === 'string')
          .map((g) => g.trim().toLowerCase())
          .filter(Boolean)
      : undefined
    return {
      sub,
      iss,
      email,
      name,
      idToken: idToken || undefined,
      ...(groups?.length ? { groups } : {}),
    }
  } catch {
    return null
  }
}

export function readSessionCookie(c: Context): string | undefined {
  return getCookie(c, env.cookieName)
}

export async function getSession(c: Context): Promise<SessionUser | null> {
  const raw = readSessionCookie(c)
  if (!raw) return null
  return openSession(raw)
}

export async function setSessionCookie(
  c: Context,
  user: SessionUser,
): Promise<void> {
  const token = await sealSession(user)
  setCookie(c, env.cookieName, token, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'Lax',
    path: '/',
    maxAge: env.sessionTtlSec,
  })
}

export function clearSessionCookie(c: Context): void {
  // Attributes must match Set-Cookie or browsers keep the session cookie.
  deleteCookie(c, env.cookieName, {
    path: '/',
    secure: env.cookieSecure,
    sameSite: 'Lax',
  })
  setCookie(c, env.cookieName, '', {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'Lax',
    path: '/',
    maxAge: 0,
  })
}
