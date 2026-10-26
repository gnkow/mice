import { createHash, randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { getDb } from '../../db/database.js'
import { principals, webSessions } from '../../db/schema.js'
import { env } from '../../env.js'
import { isCredentialRevoked } from '../credentials/credentialRevocation.js'

export type PatScope = {
  namespace: string
  /** Omit = all repos in namespace. */
  repo?: string
  maxRole: 'read' | 'triage' | 'write' | 'maintain' | 'admin'
}

export type SessionUser = {
  sub: string
  iss: string
  /** Internal Principal id, present once the user has a Session or a stored Principal. */
  principalId?: number
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

const hashId = (id: string) => createHash('sha256').update(id).digest('hex')

/** Issuers are compared and stored without a trailing slash, so `https://idp/` and `https://idp` are one Principal. */
export function canonicalIssuer(iss: string): string {
  return iss.trim().replace(/\/+$/, '')
}

/** The Principal row for an IdP identity, created on first sight. Returns its internal id. */
export async function ensurePrincipal(identity: { iss: string; sub: string }): Promise<number> {
  const iss = canonicalIssuer(identity.iss)
  const [row] = await getDb()
    .insert(principals)
    .values({ iss, sub: identity.sub, createdAt: new Date() })
    .onConflictDoUpdate({ target: [principals.iss, principals.sub], set: { iss } })
    .returning({ id: principals.id })
  return row!.id
}

/** Creates the server-side Session row for a user and returns the opaque id that goes into the cookie. */
export async function sealSession(user: SessionUser): Promise<string> {
  const id = randomBytes(32).toString('base64url')
  const start = user.sessionStart ?? nowSec()
  await getDb().insert(webSessions).values({
    idHash: hashId(id),
    principalId: await ensurePrincipal(user),
    email: user.email,
    emailVerified: user.emailVerified === true,
    name: user.name,
    idToken: user.idToken ?? null,
    groups: user.groups ?? [],
    authTime: user.authTime ?? null,
    sessionStart: start,
    lastActive: user.lastActive ?? nowSec(),
  })
  return id
}

async function loadSession(id: string): Promise<SessionUser | null> {
  const [row] = await getDb()
    .select({ s: webSessions, iss: principals.iss, sub: principals.sub })
    .from(webSessions)
    .innerJoin(principals, eq(principals.id, webSessions.principalId))
    .where(eq(webSessions.idHash, hashId(id)))
  if (!row) return null
  const { s } = row
  const now = nowSec()
  const expired = now >= s.sessionStart + env.sessionTtlSec
  const idle = env.sessionIdleSec > 0 && now - s.lastActive > env.sessionIdleSec
  if (expired || idle) {
    await getDb().delete(webSessions).where(eq(webSessions.idHash, s.idHash))
    return null
  }
  return {
    sub: row.sub,
    iss: row.iss,
    principalId: s.principalId,
    email: s.email,
    name: s.name,
    ...(s.idToken ? { idToken: s.idToken } : {}),
    ...(s.emailVerified ? { emailVerified: true } : {}),
    ...(s.authTime !== null ? { authTime: s.authTime } : {}),
    sessionStart: s.sessionStart,
    lastActive: s.lastActive,
    ...(s.groups.length ? { groups: s.groups } : {}),
  }
}

/** A valid, unexpired, unrevoked Session; a revocation lookup that cannot reach its store throws instead of denying. */
export async function openSession(token: string): Promise<SessionUser | null> {
  const user = await loadSession(token)
  if (!user) return null
  if (await isCredentialRevoked({ iss: user.iss, sub: user.sub }, user.sessionStart ?? 0, 'session')) return null
  return user
}

export function readSessionCookie(c: Context): string | undefined {
  return getCookie(c, env.cookieName)
}

export async function getSession(c: Context): Promise<SessionUser | null> {
  const raw = readSessionCookie(c)
  if (!raw) return null
  return openSession(raw)
}

/** Issues a new Session for `user` and sets its cookie. */
export async function setSessionCookie(c: Context, user: SessionUser): Promise<void> {
  const id = await sealSession(user)
  writeCookie(c, id, (user.sessionStart ?? nowSec()) + env.sessionTtlSec - nowSec())
}

function writeCookie(c: Context, id: string, maxAge: number): void {
  // `__Host-` requires Secure, no Domain and Path=/; the browser refuses the cookie otherwise.
  setCookie(c, env.cookieName, id, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: Math.max(1, maxAge),
  })
}

/** Extend an idle-limited Session on activity without moving its absolute expiry. */
export async function touchSession(c: Context, user: SessionUser): Promise<void> {
  if (env.sessionIdleSec <= 0) return
  const last = user.lastActive ?? 0
  const throttle = Math.max(1, Math.floor(env.sessionIdleSec / 4))
  if (nowSec() - last < throttle) return
  const id = readSessionCookie(c)
  if (!id) return
  await getDb().update(webSessions).set({ lastActive: nowSec() }).where(eq(webSessions.idHash, hashId(id)))
  writeCookie(c, id, (user.sessionStart ?? nowSec()) + env.sessionTtlSec - nowSec())
}

/** Deletes the server-side Session behind the request's cookie. */
export async function destroySession(c: Context): Promise<void> {
  const id = readSessionCookie(c)
  if (id) await getDb().delete(webSessions).where(eq(webSessions.idHash, hashId(id)))
}

export function clearSessionCookie(c: Context): void {
  // Attributes must match Set-Cookie or browsers keep the session cookie.
  deleteCookie(c, env.cookieName, { path: '/', secure: true, sameSite: 'Lax' })
  setCookie(c, env.cookieName, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 0,
  })
}
