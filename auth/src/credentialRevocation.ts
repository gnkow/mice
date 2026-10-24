import { join } from 'node:path'
import { isInstanceAdmin } from './authzStore.js'
import { env } from './env.js'
import { principalKey } from './principal.js'
import { suspendOwnedWithAudit } from './servicePrincipalOffboarding.js'
import { actorFromUser } from './audit.js'
import type { SessionUser } from './session.js'
import { readJsonFile, writeJsonFile } from './jsonStore.js'

/** `notBefore` is the full cut-off (Sessions and PATs); `sessionsNotBefore` ends Sessions only. */
type Store = {
  version: 1
  notBefore: Record<string, number>
  sessionsNotBefore?: Record<string, number>
}
type CredentialKind = 'session' | 'pat'

const path = () => join(env.dataDir, 'session-revocations.json')
const nowSec = () => Math.floor(Date.now() / 1000)

function read(): Store {
  const s = readJsonFile<Store | null>(path(), null)
  return s && s.version === 1 && s.notBefore ? s : { version: 1, notBefore: {} }
}

function raise(table: Record<string, number>, key: string, cutoff: number): number {
  const next = Math.max(table[key] ?? 0, cutoff)
  table[key] = next
  return next
}

/** Invalidate every Session and PAT of a Principal issued up to now. Returns the cut-off (epoch s). */
export function revokeSessionsFor(principal: { iss: string; sub: string }): number {
  const s = read()
  const cutoff = raise(s.notBefore, principalKey(principal), nowSec())
  writeJsonFile(path(), s)
  return cutoff
}

/** Invalidate Sessions only; PATs stay valid. Returns the cut-off (epoch s). */
export function revokeSessionsOnlyFor(
  principal: { iss: string; sub: string },
  at: number = nowSec(),
): number {
  const s = read()
  s.sessionsNotBefore ??= {}
  const cutoff = raise(s.sessionsNotBefore, principalKey(principal), at)
  writeJsonFile(path(), s)
  return cutoff
}

/** Instance-admin action: revoke every Session and PAT issued to `target` so far. */
export function revokeSessions(
  actor: { iss: string; sub: string },
  target: { iss: string; sub: string },
): { ok: true } | { ok: false; error: string } {
  if (!isInstanceAdmin(actor)) return { ok: false, error: 'Forbidden' }
  revokeSessionsFor(target)
  suspendOwnedWithAudit(target, 'admin-revocation', actorFromUser(actor as SessionUser))
  return { ok: true }
}

/**
 * True when a credential of `kind` (Session cookie or PAT) first issued at `issuedAt` (epoch s)
 * predates the Principal's revocation cut-off. Every credential type must pass this check.
 */
export function isCredentialRevoked(
  principal: { iss: string; sub: string },
  issuedAt: number,
  kind: CredentialKind,
): boolean {
  const s = read()
  const key = principalKey(principal)
  const full = s.notBefore[key]
  const sessionsOnly = kind === 'session' ? s.sessionsNotBefore?.[key] : undefined
  const cutoff = Math.max(full ?? -1, sessionsOnly ?? -1)
  return cutoff >= 0 && issuedAt <= cutoff
}
