import { join } from 'node:path'
import { isInstanceAdmin } from './authzStore.js'
import { env } from './env.js'
import { readJsonFile, writeJsonFile } from './jsonStore.js'

type Store = { version: 1; notBefore: Record<string, number> }

const path = () => join(env.dataDir, 'session-revocations.json')
const keyOf = (p: { iss: string; sub: string }) => `${p.iss}\0${p.sub}`
const nowSec = () => Math.floor(Date.now() / 1000)

function read(): Store {
  const s = readJsonFile<Store | null>(path(), null)
  return s && s.version === 1 && s.notBefore ? s : { version: 1, notBefore: {} }
}

/** Invalidate every Session of a Principal issued up to now. Returns the cut-off (epoch s). */
export function revokeSessionsFor(principal: { iss: string; sub: string }): number {
  const s = read()
  const cutoff = nowSec()
  s.notBefore[keyOf(principal)] = cutoff
  writeJsonFile(path(), s)
  return cutoff
}

/** Instance-admin action: revoke every Session of `target`. */
export function revokeSessions(
  actor: { iss: string; sub: string },
  target: { iss: string; sub: string },
): { ok: true } | { ok: false; error: string } {
  if (!isInstanceAdmin(actor)) return { ok: false, error: 'Forbidden' }
  revokeSessionsFor(target)
  return { ok: true }
}

/** True when the Session (first issued at `sessionStart`) predates a revocation. */
export function isSessionRevoked(
  principal: { iss: string; sub: string },
  sessionStart: number,
): boolean {
  const cutoff = read().notBefore[keyOf(principal)]
  return cutoff !== undefined && sessionStart <= cutoff
}
