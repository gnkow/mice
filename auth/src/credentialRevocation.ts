import { join } from 'node:path'
import { currentClock } from './clock.js'
import { env } from './env.js'
import { principalKey } from './principal.js'
import { defineStore } from './typedStore.js'

/** `notBefore` is the full cut-off (Sessions and PATs); `sessionsNotBefore` ends Sessions only. */
type Store = {
  version: 1
  notBefore: Record<string, number>
  sessionsNotBefore?: Record<string, number>
}
type CredentialKind = 'session' | 'pat'

const store = defineStore<Store>({
  file: () => join(env.dataDir, 'session-revocations.json'),
  empty: () => ({ version: 1, notBefore: {} }),
  valid: (raw) => (raw as Store | null)?.version === 1 && !!(raw as Store).notBefore,
})
const nowSec = () => Math.floor(currentClock.now() / 1000)

function raise(table: Record<string, number>, key: string, cutoff: number): number {
  const next = Math.max(table[key] ?? 0, cutoff)
  table[key] = next
  return next
}

/** Invalidate every Session and PAT of a Principal issued up to now. Returns the cut-off (epoch s). */
export function revokeSessionsFor(principal: { iss: string; sub: string }): number {
  return store.update((s) => raise(s.notBefore, principalKey(principal), nowSec()))
}

/** Invalidate Sessions only; PATs stay valid. Returns the cut-off (epoch s). */
export function revokeSessionsOnlyFor(
  principal: { iss: string; sub: string },
  at: number = nowSec(),
): number {
  return store.update((s) => {
    s.sessionsNotBefore ??= {}
    return raise(s.sessionsNotBefore, principalKey(principal), at)
  })
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
  const s = store.read()
  const key = principalKey(principal)
  const full = s.notBefore[key]
  const sessionsOnly = kind === 'session' ? s.sessionsNotBefore?.[key] : undefined
  const cutoff = Math.max(full ?? -1, sessionsOnly ?? -1)
  return cutoff >= 0 && issuedAt <= cutoff
}
