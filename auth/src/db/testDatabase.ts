import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { postgresConfig } from './connection.js'
import { closeMainDatabase, getDb, migrateDatabase, postgresReadiness } from './database.js'

/**
 * Test helper for the live PostgreSQL container shared with dev. Tests never create schemas or
 * databases: they use unique ids and delete only the rows they created.
 */
export async function connectTestDatabase() {
  const ready = await postgresReadiness().catch(() => ({ ok: false, detail: 'unreachable' }))
  if (!ready.ok) {
    await migrateDatabase().catch((e: unknown) => {
      throw new Error(
        `PostgreSQL is not reachable for tests (${e instanceof Error ? e.message : String(e)}). ` +
          'Start the databases with `make up` (or `docker compose up -d postgres immudb`).',
      )
    })
  }
  const runId = randomUUID().slice(0, 8)
  const cleanups: Array<() => Promise<unknown>> = []
  return {
    db: getDb(),
    runId,
    /** A fresh id carrying this run's prefix, so cleanup and assertions can target only it. */
    id(label = 'id'): string {
      return `t-${runId}-${label}-${randomUUID().slice(0, 8)}`
    },
    /** Registers a delete to run (newest first) when the test finishes. */
    onCleanup(fn: () => Promise<unknown>) {
      cleanups.push(fn)
    },
    async close() {
      while (cleanups.length) await cleanups.pop()!()
      await closeMainDatabase()
    },
  }
}

const SCHEMA_PATTERN = /^t_[0-9a-f]{12}$/

/**
 * Gives this test process its own schema inside the live PostgreSQL server (same engine, same
 * protocol, same migrations as production) and returns a function that drops it. Parallel test
 * files cannot collide with each other or with dev data.
 */
export async function useTestSchema(): Promise<() => Promise<void>> {
  const schema = `t_${randomUUID().replaceAll('-', '').slice(0, 12)}`
  if (!SCHEMA_PATTERN.test(schema)) throw new Error('bad test schema name')
  const admin = new pg.Client(postgresConfig())
  await admin.connect().catch((e: unknown) => {
    throw new Error(
      `PostgreSQL is not reachable for tests (${e instanceof Error ? e.message : String(e)}). ` +
        'Start the databases with `make up` (or `docker compose up -d postgres immudb`).',
    )
  })
  await admin.query(`create schema "${schema}"`)
  await admin.end()
  process.env.MICE_TEST_SCHEMA = schema
  await closeMainDatabase()
  await migrateDatabase()
  return async () => {
    await closeMainDatabase()
    const c = new pg.Client({ ...postgresConfig(), options: undefined })
    await c.connect()
    await c.query(`drop schema if exists "${schema}" cascade`)
    await c.end()
    delete process.env.MICE_TEST_SCHEMA
  }
}

/** Simulates a storage fault on one table of the test schema; the returned function repairs it. */
export async function breakTable(table: string): Promise<() => Promise<void>> {
  if (!/^[a-z_]+$/.test(table)) throw new Error('bad table name')
  const { getDb } = await import('./database.js')
  const { sql } = await import('drizzle-orm')
  await getDb().execute(sql.raw(`alter table "${table}" rename to "${table}__broken"`))
  return async () => {
    await getDb().execute(sql.raw(`alter table "${table}__broken" rename to "${table}"`))
  }
}
