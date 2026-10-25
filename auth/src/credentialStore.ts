import { createDocumentStore } from './stores.js'
import { currentClock, type Clock } from './clock.js'
import type { PatScope } from './session.js'

export type PatSource = 'cli-login' | 'manual'

export type PatPublic = {
  id: string
  label: string
  prefix: string
  createdAt: string
  lastUsedAt?: string
  expiresAt?: string
  scopes?: PatScope[]
  source?: PatSource
}

export type PatRecord = PatPublic & {
  tokenHash: string
  sub: string
  iss: string
  email: string
  name: string
  /** IdP groups snapshotted at mint time for live group AuthZ. */
  groups?: string[]
}

/** Where credential records live. Holds no policy: expiry, revocation and activity are decided elsewhere. */
export interface CredentialStore {
  list(): PatRecord[]
  findByHash(tokenHash: string): PatRecord | undefined
  save(record: PatRecord): void
  /** Sets `lastUsedAt` on the record with this hash. */
  touch(tokenHash: string, at: string): void
  /** Removes every record matching `match`; returns how many went. */
  remove(match: (record: PatRecord) => boolean): number
}

export function createMemoryCredentialStore(initial: PatRecord[] = []): CredentialStore {
  let records = [...initial]
  return {
    list: () => records,
    findByHash: (h) => records.find((r) => r.tokenHash === h),
    save: (r) => void records.push(r),
    touch(h, at) {
      const r = records.find((x) => x.tokenHash === h)
      if (r) r.lastUsedAt = at
    },
    remove(match) {
      const before = records.length
      records = records.filter((r) => !match(r))
      return before - records.length
    },
  }
}

type StoreFile = { version: 1; tokens: PatRecord[] }

export const LEGACY_EXPIRY_MS = 365 * 24 * 60 * 60 * 1000

/** JSON-file adapter (through the jsonStore persistence seam). */
export function createFileCredentialStore(opts: {
  path: () => string
  clock?: Clock
}): CredentialStore {
  const clock = opts.clock ?? currentClock
  const doc = createDocumentStore<StoreFile | null>({ path: opts.path, initial: () => null, onCorrupt: 'initial' })
  const write = (s: StoreFile) => doc.write(s)
  function read(): StoreFile {
    try {
      const parsed = doc.read()
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.tokens)) {
        return { version: 1, tokens: [] }
      }
      // Grandfather tokens minted before expiry existed; persisted, so it happens once.
      const legacy = parsed.tokens.filter((t) => !t.expiresAt)
      if (legacy.length) {
        const grandfathered = new Date(clock.now() + LEGACY_EXPIRY_MS).toISOString()
        for (const t of legacy) t.expiresAt = grandfathered
        write(parsed)
      }
      return parsed
    } catch {
      return { version: 1, tokens: [] }
    }
  }
  return {
    list: () => read().tokens,
    findByHash: (h) => read().tokens.find((r) => r.tokenHash === h),
    save(r) {
      const s = read()
      s.tokens.push(r)
      write(s)
    },
    touch(h, at) {
      const s = read()
      const r = s.tokens.find((x) => x.tokenHash === h)
      if (!r) return
      r.lastUsedAt = at
      write(s)
    },
    remove(match) {
      const s = read()
      const before = s.tokens.length
      s.tokens = s.tokens.filter((r) => !match(r))
      if (s.tokens.length === before) return 0
      write(s)
      return before - s.tokens.length
    },
  }
}
