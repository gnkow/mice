import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { sql } from 'drizzle-orm'
import pg from 'pg'
import { postgresConfig } from './connection.js'
import * as schema from './schema.js'

export type Db = NodePgDatabase<typeof schema>
/** Same query surface as the pool, bound to one open transaction. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url))
const MIGRATIONS_TABLE = '__drizzle_migrations'
const migrationsSchema = () => process.env.MICE_TEST_SCHEMA ?? 'drizzle'

let pool: pg.Pool | null = null
let db: Db | null = null
let lastFailure: string | null = null

function ensureOpen(): { pool: pg.Pool; db: Db } {
  if (!pool || !db) {
    pool = new pg.Pool({ ...postgresConfig(), max: 10, connectionTimeoutMillis: 3000 })
    pool.on('error', (e) => { lastFailure = e.message })
    db = drizzle(pool, { schema })
  }
  return { pool, db }
}

/** The shared database handle. Opens the pool lazily. */
export function getDb(): Db {
  return ensureOpen().db
}

export function expectedMigrationCount(): number {
  const journal = JSON.parse(
    readFileSync(`${MIGRATIONS_FOLDER}/meta/_journal.json`, 'utf8'),
  ) as { entries: unknown[] }
  return journal.entries.length
}

/** Applies pending migrations, then refuses a database that is ahead of this release. */
export async function migrateDatabase(): Promise<void> {
  const { db } = ensureOpen()
  await migrate(db, {
    migrationsFolder: MIGRATIONS_FOLDER,
    migrationsTable: MIGRATIONS_TABLE,
    migrationsSchema: migrationsSchema(),
  })
  assertSchemaVersion(await schemaVersion(), expectedMigrationCount())
}

/** Startup gate: a database ahead of or behind this release must not serve traffic. */
export function assertSchemaVersion(applied: number, expected: number): void {
  if (applied !== expected) {
    throw new Error(
      `Database schema v${applied} does not match this release (v${expected}); upgrade the BFF`,
    )
  }
}

export async function schemaVersion(): Promise<number> {
  const { db } = ensureOpen()
  const res = await db.execute<{ n: string }>(
    sql.raw(`select count(*)::text as n from "${migrationsSchema()}"."${MIGRATIONS_TABLE}"`),
  )
  return Number(res.rows[0]?.n ?? 0)
}

/** Boot-time entry: open the pool and bring the schema to this release, or throw. */
export async function openMainDatabase(): Promise<void> {
  await migrateDatabase()
  lastFailure = null
}

export async function closeMainDatabase(): Promise<void> {
  const p = pool
  pool = null
  db = null
  if (p) await p.end()
}

export type PostgresReadiness = { ok: boolean; detail?: string; schemaVersion?: number }

/** Live probe for `/readyz`: red whenever PostgreSQL cannot answer or the schema is not this release's. */
export async function postgresReadiness(): Promise<PostgresReadiness> {
  try {
    const version = await schemaVersion()
    const expected = expectedMigrationCount()
    if (version !== expected) {
      return { ok: false, schemaVersion: version, detail: `schema v${version}, expected v${expected}` }
    }
    return { ok: true, schemaVersion: version }
  } catch (e) {
    lastFailure = e instanceof Error ? e.message : String(e)
    return { ok: false, detail: lastFailure }
  }
}

/**
 * Runs `work` inside one real transaction: commit when it resolves, roll back when it throws.
 * Do not call it from inside `work`; pass the `tx` down instead.
 */
export async function inTransaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  return getDb().transaction(work)
}
