import { createHash, randomBytes } from 'node:crypto'
import { eq, asc, and } from 'drizzle-orm'
import type { Context } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { getDb } from '../../db/database.js'
import { principals, webSessions } from '../../db/schema.js'
import { env } from '../../env.js'
import { isCredentialRevoked } from '../credentials/credentialRevocation.js'
import { appendAudit } from '../../audit.js'
import { trackNameChange } from './nameChangeHistory.js'
import { sealSessionCookie, unsealSessionCookie } from './cookieSeal.js'
import { canonicalIssuer } from './principal.js'

export { canonicalIssuer }

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
  /** IdP groups, matched against namespace and repository group grants an administrator has recorded. */
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

/** The Principal row for an IdP identity, created on first sight. Returns its internal id. */
export async function ensurePrincipal(identity: { iss: string; sub: string; name?: string; email?: string }): Promise<number> {
  const iss = canonicalIssuer(identity.iss)
  
  // First try to find existing principal
  const existing = await getDb()
    .select({ id: principals.id, email: principals.email })
    .from(principals)
    .where(and(eq(principals.iss, iss), eq(principals.sub, identity.sub)))
    .limit(1)
  
  let principalId: number
  
  if (existing.length > 0) {
    principalId = existing[0].id
    if (identity.email && existing[0].email !== identity.email) {
      await getDb().update(principals).set({ email: identity.email }).where(eq(principals.id, principalId))
    }
  } else {
    const [row] = await getDb()
      .insert(principals)
      .values({ iss, sub: identity.sub, name: identity.name ?? null, email: identity.email ?? null, createdAt: new Date() })
      .returning({ id: principals.id })
    principalId = row!.id
  }
  
  // Ticket 22: Track name changes on login (works for both new and existing principals)
  if (identity.name) {
    await trackNameChange(principalId, identity.name)
  }
  
  return principalId
}

/** The Principal's current email, or null when this identity has none stored. */
export async function getCurrentEmail(identity: { iss: string; sub: string }): Promise<string | null> {
  const iss = canonicalIssuer(identity.iss)
  const [row] = await getDb()
    .select({ email: principals.email })
    .from(principals)
    .where(and(eq(principals.iss, iss), eq(principals.sub, identity.sub)))
    .limit(1)
  return row?.email ?? null
}

/** Current emails for commit authors (`iss|sub`). Unknown authors are omitted. */
export async function currentEmailsByAuthor(authors: string[]): Promise<Record<string, string>> {
  const emails: Record<string, string> = {}
  for (const author of authors) {
    const bar = author.indexOf('|')
    if (bar <= 0 || bar === author.length - 1) continue
    const email = await getCurrentEmail({ iss: author.slice(0, bar), sub: author.slice(bar + 1) })
    if (email) emails[author] = email
  }
  return emails
}

/**
 * Creates the server-side Session row for a user and returns the opaque id that goes into the cookie.
 * 
 * Enforces 5-session cap per Principal (Round 8 U4). When cap exceeded, evicts
 * oldest session by sessionStart timestamp (Part 11 §11.300(b) authority checks).
 */
export async function sealSession(user: SessionUser): Promise<string> {
  const id = randomBytes(32).toString('base64url')
  const start = user.sessionStart ?? nowSec()
  const principalId = await ensurePrincipal(user)
  await getDb()
    .update(principals)
    .set({ lastLoginAt: new Date(start * 1000) })
    .where(eq(principals.id, principalId))

  // Enforce 5-session cap: count existing sessions for this Principal
  const existingSessions = await getDb()
    .select({
      idHash: webSessions.idHash,
      sessionStart: webSessions.sessionStart,
    })
    .from(webSessions)
    .where(eq(webSessions.principalId, principalId))
    .orderBy(asc(webSessions.sessionStart)) // Oldest first

  // If at cap (5 sessions), evict the oldest before creating new one
  if (existingSessions.length >= 5) {
    const oldestSession = existingSessions[0]
    await getDb()
      .delete(webSessions)
      .where(eq(webSessions.idHash, oldestSession.idHash))
    
    // Audit event for automatic session eviction (Ticket 15, U4)
    await appendAudit({
      actor: { sub: user.sub, iss: user.iss, email: user.email, name: user.name },
      via: 'system',
      method: 'POST',
      path: '/auth/session/seal',
      status: 200,
      action: 'session.evict',
      message: `Session evicted: cap exceeded (5 concurrent sessions max)`,
      detail: {
        evictedSessionHash: oldestSession.idHash,
        evictedSessionStart: oldestSession.sessionStart,
        reason: 'cap-exceeded',
        cap: 5,
      },
    })
  }

  await getDb().insert(webSessions).values({
    idHash: hashId(id),
    principalId,
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

export async function readSessionCookie(c: Context): Promise<string | undefined> {
  const sealed = getCookie(c, env.cookieName)
  if (!sealed) return undefined
  
  // Unseal the cookie with any valid key in the ring
  const sessionId = await unsealSessionCookie(sealed)
  return sessionId ?? undefined
}

export async function getSession(c: Context): Promise<SessionUser | null> {
  const raw = await readSessionCookie(c)
  if (!raw) return null
  return openSession(raw)
}

/** Issues a new Session for `user` and sets its cookie. */
export async function setSessionCookie(c: Context, user: SessionUser): Promise<void> {
  const id = await sealSession(user)
  const sealed = await sealSessionCookie(id)
  writeCookie(c, sealed, (user.sessionStart ?? nowSec()) + env.sessionTtlSec - nowSec())
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
  const id = await readSessionCookie(c)
  if (!id) return
  await getDb().update(webSessions).set({ lastActive: nowSec() }).where(eq(webSessions.idHash, hashId(id)))
  const sealed = await sealSessionCookie(id)
  writeCookie(c, sealed, (user.sessionStart ?? nowSec()) + env.sessionTtlSec - nowSec())
}

/** Deletes the server-side Session behind the request's cookie. */
export async function destroySession(c: Context): Promise<void> {
  const id = await readSessionCookie(c)
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
