import { createHash, randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { currentClock, type Clock } from './clock.js'
import { env } from './env.js'
import { isCredentialRevoked } from './credentialRevocation.js'
import { judgeCredential, isExpired, shouldRecordUse } from './credentialPolicy.js'
import {
  createFileCredentialStore,
  type CredentialStore,
  type PatPublic,
  type PatRecord,
  type PatSource,
} from './credentialStore.js'
import { kindOf } from './principal.js'
import { isServiceCredentialActive } from './servicePrincipals.js'
import type { PatScope, SessionUser } from './session.js'

export type { PatPublic, PatSource }

export const PAT_DEFAULT_DAYS = 90
export const PAT_MAX_DAYS = 365
const DAY_MS = 24 * 60 * 60 * 1000

export class PatExpiryError extends Error {}

export type CreatePatOptions = {
  scopes?: PatScope[]
  source?: PatSource
  /** Lifetime in days: default 90, max 365. */
  expiresInDays?: number
}

const TOKEN_PREFIX = 'mice_pat_'

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

function toPublic(rec: PatRecord): PatPublic {
  return {
    id: rec.id,
    label: rec.label,
    prefix: rec.prefix,
    createdAt: rec.createdAt,
    lastUsedAt: rec.lastUsedAt,
    expiresAt: rec.expiresAt,
    ...(rec.scopes?.length ? { scopes: rec.scopes } : {}),
    ...(rec.source ? { source: rec.source } : {}),
  }
}

export type CredentialDeps = {
  store: CredentialStore
  clock: Clock
  isRevoked: (principal: { iss: string; sub: string }, issuedAtSec: number) => boolean
  isServiceActive: (id: string) => boolean
}

export type ResolveOptions = {
  /** Record `lastUsedAt` (debounced). Default true. */
  touch?: boolean
}

/** Credential operations over an injected store, clock and policy inputs. */
export function createCredentials(deps: CredentialDeps) {
  const { store, clock } = deps
  const facts = () => ({
    nowMs: clock.now(),
    isRevoked: (r: PatRecord, issuedAtSec: number) => deps.isRevoked(r, issuedAtSec),
    isServiceActive: deps.isServiceActive,
  })

  function listPatsForUser(user: SessionUser): PatPublic[] {
    return store
      .list()
      .filter((t) => t.sub === user.sub && t.iss === user.iss)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(toPublic)
  }

  /** Live PATs of service principals, for expiry notices. */
  function listServicePats(): Array<{ id: string; sub: string; iss: string; expiresAt: string }> {
    const nowMs = clock.now()
    return store
      .list()
      .filter(
        (t) =>
          kindOf(t) === 'service' &&
          !isExpired(t, nowMs) &&
          t.expiresAt &&
          !deps.isRevoked(t, Math.floor(Date.parse(t.createdAt) / 1000)),
      )
      .map((t) => ({ id: t.id, sub: t.sub, iss: t.iss, expiresAt: t.expiresAt! }))
  }

  /** Distinct owners of stored PATs (for directory sync). */
  function listPatOwners(): Array<{ sub: string; iss: string; email: string; name: string }> {
    const seen = new Map<string, { sub: string; iss: string; email: string; name: string }>()
    for (const t of store.list()) {
      seen.set(`${t.iss}\0${t.sub}`, { sub: t.sub, iss: t.iss, email: t.email, name: t.name })
    }
    return [...seen.values()]
  }

  function createPat(
    user: SessionUser,
    label: string,
    scopesOrOpts?: PatScope[] | CreatePatOptions,
  ): { token: string; pat: PatPublic } {
    const opts: CreatePatOptions = Array.isArray(scopesOrOpts)
      ? { scopes: scopesOrOpts }
      : (scopesOrOpts ?? {})
    const scopes = opts.scopes
    const days = opts.expiresInDays ?? PAT_DEFAULT_DAYS
    if (!Number.isInteger(days) || days < 1 || days > PAT_MAX_DAYS) {
      throw new PatExpiryError(`Token expiry must be 1-${PAT_MAX_DAYS} days`)
    }
    const secret = randomBytes(24).toString('base64url')
    const token = `${TOKEN_PREFIX}${secret}`
    const now = clock.now()
    const rec: PatRecord = {
      id: randomBytes(8).toString('hex'),
      label: label.trim() || 'CLI token',
      prefix: token.slice(0, TOKEN_PREFIX.length + 6),
      tokenHash: hashToken(token),
      sub: user.sub,
      iss: user.iss,
      email: user.email,
      name: user.name,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + days * DAY_MS).toISOString(),
      source: opts.source ?? 'manual',
      ...(scopes?.length ? { scopes } : {}),
      ...(user.groups?.length ? { groups: [...user.groups] } : {}),
    }
    store.save(rec)
    return { token, pat: toPublic(rec) }
  }

  function revokePat(user: SessionUser, id: string): boolean {
    return store.remove((t) => t.id === id && t.sub === user.sub && t.iss === user.iss) > 0
  }

  /** Revoke a PAT by raw bearer value (CLI logout). */
  function revokePatByToken(rawBearer: string): boolean {
    const token = rawBearer.trim()
    if (!token.startsWith(TOKEN_PREFIX)) return false
    const tokenHash = hashToken(token)
    return store.remove((t) => t.tokenHash === tokenHash) > 0
  }

  /** Resolve a bearer PAT to a session identity, or null. */
  function resolvePat(rawBearer: string, opts: ResolveOptions = {}): SessionUser | null {
    const token = rawBearer.trim()
    if (!token.startsWith(TOKEN_PREFIX)) return null
    const tokenHash = hashToken(token)
    const rec = store.findByHash(tokenHash)
    if (!rec || judgeCredential(rec, facts()) !== 'ok') return null
    if ((opts.touch ?? true) && shouldRecordUse(rec, clock.now())) {
      store.touch(tokenHash, new Date(clock.now()).toISOString())
    }
    return {
      sub: rec.sub,
      iss: rec.iss,
      email: rec.email,
      name: rec.name,
      ...(rec.scopes?.length ? { patScopes: rec.scopes } : {}),
      ...(rec.groups?.length ? { groups: [...rec.groups] } : {}),
    }
  }

  /** Look up public PAT metadata by raw bearer (no lastUsed bump). */
  function findPatByToken(rawBearer: string): PatPublic | null {
    const token = rawBearer.trim()
    if (!token.startsWith(TOKEN_PREFIX)) return null
    const rec = store.findByHash(hashToken(token))
    return rec ? toPublic(rec) : null
  }

  return {
    listPatsForUser,
    listServicePats,
    listPatOwners,
    createPat,
    revokePat,
    revokePatByToken,
    resolvePat,
    findPatByToken,
  }
}

/** Process-wide instance: file store under AUTH_DATA_DIR, process clock, real revocation and service policy. */
const defaults = createCredentials({
  store: createFileCredentialStore({ path: () => join(env.dataDir, 'pats.json') }),
  clock: currentClock,
  isRevoked: (p, issuedAt) => isCredentialRevoked(p, issuedAt, 'pat'),
  isServiceActive: isServiceCredentialActive,
})

export const listPatsForUser = defaults.listPatsForUser
export const listServicePats = defaults.listServicePats
export const listPatOwners = defaults.listPatOwners
export const createPat = defaults.createPat
export const revokePat = defaults.revokePat
export const revokePatByToken = defaults.revokePatByToken
export const resolvePat = defaults.resolvePat
export const findPatByToken = defaults.findPatByToken

export function isPatToken(rawBearer: string): boolean {
  return rawBearer.trim().startsWith(TOKEN_PREFIX)
}
