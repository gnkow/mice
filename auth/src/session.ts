import { createHash } from 'node:crypto'
import { EncryptJWT, jwtDecrypt } from 'jose'
import type { Context } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { env } from './env.js'
import { isSessionRevoked } from './sessionRevocation.js'

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
  /** True only when the IdP asserted `email_verified`. */
  emailVerified?: boolean
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
  /** Epoch seconds of the IdP authentication (id_token `auth_time`), if provided. */
  authTime?: number
  /** Epoch seconds the Session was first issued (absolute TTL anchor). */
  sessionStart?: number
  /** Epoch seconds of the last activity re-seal (idle timeout anchor). */
  lastActive?: number
}

const nowSec = () => Math.floor(Date.now() / 1000)

function secretKey() {
  return createHash('sha256').update(env.sessionSecret).digest()
}

export async function sealSession(user: SessionUser): Promise<string> {
  const start = user.sessionStart ?? nowSec()
  return new EncryptJWT({
    ...(user.authTime !== undefined ? { auth_time: user.authTime } : {}),
    sat: start,
    act: user.lastActive ?? nowSec(),
    sub: user.sub,
    iss: user.iss,
    email: user.email,
    email_verified: user.emailVerified === true,
    name: user.name,
    id_token: user.idToken ?? '',
    groups: user.groups ?? [],
  })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setExpirationTime(start + env.sessionTtlSec)
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
    const iat = Number(payload.iat ?? 0)
    const sessionStart = Number(payload.sat ?? iat)
    const lastActive = Number(payload.act ?? iat)
    if (isSessionRevoked({ iss, sub }, sessionStart)) return null
    if (env.sessionIdleSec > 0 && nowSec() - lastActive > env.sessionIdleSec) return null
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
      ...(payload.email_verified === true ? { emailVerified: true } : {}),
      ...(typeof payload.auth_time === 'number' ? { authTime: payload.auth_time } : {}),
      sessionStart,
      lastActive,
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
    maxAge: Math.max(
      1,
      (user.sessionStart ?? nowSec()) + env.sessionTtlSec - nowSec(),
    ),
  })
}

/** Extend an idle-limited Session on activity without moving its absolute expiry. */
export async function touchSession(c: Context, user: SessionUser): Promise<void> {
  if (env.sessionIdleSec <= 0) return
  const last = user.lastActive ?? 0
  const throttle = Math.max(1, Math.floor(env.sessionIdleSec / 4))
  if (nowSec() - last < throttle) return
  await setSessionCookie(c, { ...user, lastActive: nowSec() })
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
