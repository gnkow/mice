import { join } from 'node:path'
import { isInstanceAdmin } from './authzStore.js'
import { env } from './env.js'
import { principalKey } from './principal.js'
import { readJsonFile, writeJsonFile } from './jsonStore.js'

type Store = { version: 1; notBefore: Record<string, number> }

const path = () => join(env.dataDir, 'session-revocations.json')
const nowSec = () => Math.floor(Date.now() / 1000)

function read(): Store {
  const s = readJsonFile<Store | null>(path(), null)
  return s && s.version === 1 && s.notBefore ? s : { version: 1, notBefore: {} }
}

/** Invalidate every Session of a Principal issued up to now. Returns the cut-off (epoch s). */
export function revokeSessionsFor(principal: { iss: string; sub: string }): number {
  const s = read()
  const cutoff = nowSec()
  s.notBefore[principalKey(principal)] = cutoff
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
  return { ok: true }
}

/**
 * True when a credential (Session cookie or PAT) first issued at `issuedAt` (epoch s)
 * predates the Principal's revocation cut-off. Every credential type must pass this check.
 */
export function isCredentialRevoked(
  principal: { iss: string; sub: string },
  issuedAt: number,
): boolean {
  const cutoff = read().notBefore[principalKey(principal)]
  return cutoff !== undefined && issuedAt <= cutoff
}
