import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { env } from './env.js'
import { isCredentialRevoked } from './credentialRevocation.js'
import type { PatScope, SessionUser } from './session.js'

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

export const PAT_DEFAULT_DAYS = 90
export const PAT_MAX_DAYS = 365
const DAY_MS = 24 * 60 * 60 * 1000

/** Avoid rewriting pats.json on every request. */
const LAST_USED_DEBOUNCE_MS = 60_000

export class PatExpiryError extends Error {}

type PatRecord = PatPublic & {
  tokenHash: string
  sub: string
  iss: string
  email: string
  name: string
  scopes?: PatScope[]
  /** IdP groups snapshotted at mint time for live group AuthZ. */
  groups?: string[]
  source?: PatSource
}

type StoreFile = { version: 1; tokens: PatRecord[] }

const TOKEN_PREFIX = 'mice_pat_'

function storePath(): string {
  return join(env.dataDir, 'pats.json')
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

function readStore(): StoreFile {
  try {
    const raw = readFileSync(storePath(), 'utf8')
    const parsed = JSON.parse(raw) as StoreFile
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.tokens)) {
      return { version: 1, tokens: [] }
    }
    // Grandfather tokens minted before expiry existed; persisted, so it happens once.
    const legacy = parsed.tokens.filter((t) => !t.expiresAt)
    if (legacy.length) {
      const grandfathered = new Date(Date.now() + PAT_MAX_DAYS * DAY_MS).toISOString()
      for (const t of legacy) t.expiresAt = grandfathered
      writeStore(parsed)
    }
    return parsed
  } catch {
    return { version: 1, tokens: [] }
  }
}

function writeStore(store: StoreFile): void {
  mkdirSync(dirname(storePath()), { recursive: true })
  const tmp = `${storePath()}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8')
  renameSync(tmp, storePath())
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

export type CreatePatOptions = {
  scopes?: PatScope[]
  source?: PatSource
  /** Lifetime in days: default 90, max 365. */
  expiresInDays?: number
}

function isExpired(rec: PatRecord): boolean {
  return !!rec.expiresAt && Date.parse(rec.expiresAt) <= Date.now()
}

export function listPatsForUser(user: SessionUser): PatPublic[] {
  const store = readStore()
  return store.tokens
    .filter((t) => t.sub === user.sub && t.iss === user.iss)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(toPublic)
}

export function createPat(
  user: SessionUser,
  label: string,
  scopesOrOpts?: PatScope[] | CreatePatOptions,
): { token: string; pat: PatPublic } {
  const opts: CreatePatOptions = Array.isArray(scopesOrOpts)
    ? { scopes: scopesOrOpts }
    : (scopesOrOpts ?? {})
  const scopes = opts.scopes
  const source = opts.source ?? 'manual'
  const days = opts.expiresInDays ?? PAT_DEFAULT_DAYS
  if (!Number.isInteger(days) || days < 1 || days > PAT_MAX_DAYS) {
    throw new PatExpiryError(`Token expiry must be 1-${PAT_MAX_DAYS} days`)
  }
  const id = randomBytes(8).toString('hex')
  const secret = randomBytes(24).toString('base64url')
  const token = `${TOKEN_PREFIX}${secret}`
  const rec: PatRecord = {
    id,
    label: label.trim() || 'CLI token',
    prefix: token.slice(0, TOKEN_PREFIX.length + 6),
    tokenHash: hashToken(token),
    sub: user.sub,
    iss: user.iss,
    email: user.email,
    name: user.name,
    createdAt: new Date(Date.now()).toISOString(),
    expiresAt: new Date(Date.now() + days * DAY_MS).toISOString(),
    source,
    ...(scopes?.length ? { scopes } : {}),
    ...(user.groups?.length ? { groups: [...user.groups] } : {}),
  }
  const store = readStore()
  store.tokens.push(rec)
  writeStore(store)
  return { token, pat: toPublic(rec) }
}

export function revokePat(user: SessionUser, id: string): boolean {
  const store = readStore()
  const before = store.tokens.length
  store.tokens = store.tokens.filter(
    (t) => !(t.id === id && t.sub === user.sub && t.iss === user.iss),
  )
  if (store.tokens.length === before) return false
  writeStore(store)
  return true
}

/** Revoke a PAT by raw bearer value (CLI logout). */
export function revokePatByToken(rawBearer: string): boolean {
  const token = rawBearer.trim()
  if (!token.startsWith(TOKEN_PREFIX)) return false
  const tokenHash = hashToken(token)
  const store = readStore()
  const before = store.tokens.length
  store.tokens = store.tokens.filter((t) => t.tokenHash !== tokenHash)
  if (store.tokens.length === before) return false
  writeStore(store)
  return true
}

/** Resolve a Bearer token to a session identity, or null. */
export function resolvePat(rawBearer: string): SessionUser | null {
  const token = rawBearer.trim()
  if (!token.startsWith(TOKEN_PREFIX)) return null
  const tokenHash = hashToken(token)
  const store = readStore()
  const rec = store.tokens.find((t) => t.tokenHash === tokenHash)
  if (!rec || isExpired(rec)) return null
  if (isCredentialRevoked(rec, Math.floor(Date.parse(rec.createdAt) / 1000))) return null
  if (!rec.lastUsedAt || Date.now() - Date.parse(rec.lastUsedAt) >= LAST_USED_DEBOUNCE_MS) {
    rec.lastUsedAt = new Date(Date.now()).toISOString()
    writeStore(store)
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
export function findPatByToken(rawBearer: string): PatPublic | null {
  const token = rawBearer.trim()
  if (!token.startsWith(TOKEN_PREFIX)) return null
  const tokenHash = hashToken(token)
  const store = readStore()
  const rec = store.tokens.find((t) => t.tokenHash === tokenHash)
  return rec ? toPublic(rec) : null
}

export function isPatToken(rawBearer: string): boolean {
  return rawBearer.trim().startsWith(TOKEN_PREFIX)
}
