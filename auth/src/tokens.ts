import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { env } from './env.js'
import type { PatScope, SessionUser } from './session.js'

export type PatPublic = {
  id: string
  label: string
  prefix: string
  createdAt: string
  lastUsedAt?: string
  scopes?: PatScope[]
}

type PatRecord = PatPublic & {
  tokenHash: string
  sub: string
  iss: string
  email: string
  name: string
  scopes?: PatScope[]
  /** IdP groups snapshotted at mint time for live group AuthZ. */
  groups?: string[]
}

type StoreFile = { version: 1; tokens: PatRecord[] }

const TOKEN_PREFIX = 'boxen_pat_'

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
    ...(rec.scopes?.length ? { scopes: rec.scopes } : {}),
  }
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
  scopes?: PatScope[],
): { token: string; pat: PatPublic } {
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
    createdAt: new Date().toISOString(),
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

/** Resolve a Bearer token to a session identity, or null. */
export function resolvePat(rawBearer: string): SessionUser | null {
  const token = rawBearer.trim()
  if (!token.startsWith(TOKEN_PREFIX)) return null
  const tokenHash = hashToken(token)
  const store = readStore()
  const rec = store.tokens.find((t) => t.tokenHash === tokenHash)
  if (!rec) return null
  rec.lastUsedAt = new Date().toISOString()
  writeStore(store)
  return {
    sub: rec.sub,
    iss: rec.iss,
    email: rec.email,
    name: rec.name,
    ...(rec.scopes?.length ? { patScopes: rec.scopes } : {}),
    ...(rec.groups?.length ? { groups: [...rec.groups] } : {}),
  }
}

export function isPatToken(rawBearer: string): boolean {
  return rawBearer.trim().startsWith(TOKEN_PREFIX)
}
