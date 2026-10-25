import { and, eq } from 'drizzle-orm'
import { getDb } from './db/database.js'
import { pats } from './db/schema.js'
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
  list(): Promise<PatRecord[]>
  listForOwner(owner: { iss: string; sub: string }): Promise<PatRecord[]>
  findByHash(tokenHash: string): Promise<PatRecord | undefined>
  /** Rejects when the token hash already exists. */
  save(record: PatRecord): Promise<void>
  /** Sets `lastUsedAt` on the record with this hash. */
  touch(tokenHash: string, at: string): Promise<void>
  removeByHash(tokenHash: string): Promise<boolean>
  removeOwned(owner: { iss: string; sub: string }, id: string): Promise<boolean>
}

type Row = typeof pats.$inferSelect

function toRecord(r: Row): PatRecord {
  return {
    id: r.id,
    label: r.label,
    prefix: r.prefix,
    tokenHash: r.tokenHash,
    sub: r.sub,
    iss: r.iss,
    email: r.email,
    name: r.name,
    createdAt: r.createdAt.toISOString(),
    ...(r.lastUsedAt ? { lastUsedAt: r.lastUsedAt.toISOString() } : {}),
    ...(r.expiresAt ? { expiresAt: r.expiresAt.toISOString() } : {}),
    ...(r.scopes?.length ? { scopes: r.scopes } : {}),
    ...(r.source ? { source: r.source as PatSource } : {}),
    ...(r.groups?.length ? { groups: r.groups } : {}),
  }
}

/** One row per token, keyed by token hash, so using or revoking a token writes only that row. */
export function createPostgresCredentialStore(): CredentialStore {
  return {
    async list() {
      return (await getDb().select().from(pats)).map(toRecord)
    },
    async listForOwner(owner) {
      const rows = await getDb().select().from(pats).where(and(eq(pats.iss, owner.iss), eq(pats.sub, owner.sub)))
      return rows.map(toRecord)
    },
    async findByHash(h) {
      const [row] = await getDb().select().from(pats).where(eq(pats.tokenHash, h))
      return row ? toRecord(row) : undefined
    },
    async save(r) {
      await getDb().insert(pats).values({
        tokenHash: r.tokenHash,
        id: r.id,
        label: r.label,
        prefix: r.prefix,
        sub: r.sub,
        iss: r.iss,
        email: r.email,
        name: r.name,
        createdAt: new Date(r.createdAt),
        lastUsedAt: r.lastUsedAt ? new Date(r.lastUsedAt) : null,
        expiresAt: r.expiresAt ? new Date(r.expiresAt) : null,
        scopes: r.scopes ?? null,
        source: r.source ?? null,
        groups: r.groups ?? null,
      })
    },
    async touch(h, at) {
      await getDb().update(pats).set({ lastUsedAt: new Date(at) }).where(eq(pats.tokenHash, h))
    },
    async removeByHash(h) {
      const gone = await getDb().delete(pats).where(eq(pats.tokenHash, h)).returning({ id: pats.id })
      return gone.length > 0
    },
    async removeOwned(owner, id) {
      const gone = await getDb()
        .delete(pats)
        .where(and(eq(pats.id, id), eq(pats.iss, owner.iss), eq(pats.sub, owner.sub)))
        .returning({ id: pats.id })
      return gone.length > 0
    },
  }
}
