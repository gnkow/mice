import { existsSync, mkdirSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { JsonBackend, LogRow } from './jsonStore.js'

export type SqliteBackend = Required<Pick<JsonBackend, 'append' | 'readLines' | 'lastSeq' | 'rewriteLines' | 'atomically' | 'remove' | 'protectLog' | 'rowGet' | 'rowPut' | 'rowRemove' | 'rowList' | 'rowClear'>> &
  JsonBackend & {
    close(): void
    schemaVersion(): number
    latestSchemaVersion: number
    /** Lift protection so a deliberate out-of-band repair (or a tamper simulation) can alter the log. */
    unprotectLog(path: string): void
    /** Keys currently stored (documents and logs), for diagnostics and the legacy import. */
    keys(): string[]
    pragmas(): { journal_mode: string; synchronous: number }
    /** Consistent online copy (VACUUM INTO); refuses to overwrite. Restore = stop the stack and put the copy at the database path. */
    backup(dest: string): void
    /** Cheap write probe used by readiness. */
    probe(): void
  }

export type Migration = { version: number; up: (db: DatabaseSync) => void }

/** Ordered schema steps. Never edit a shipped step: add the next version. */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up: (db) =>
      db.exec(`
        CREATE TABLE IF NOT EXISTS documents (key TEXT PRIMARY KEY, body TEXT NOT NULL, updated_at TEXT NOT NULL) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS log_rows (log TEXT NOT NULL, seq INTEGER NOT NULL, line TEXT NOT NULL, PRIMARY KEY (log, seq)) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS append_only_logs (log TEXT PRIMARY KEY) WITHOUT ROWID;
        CREATE TRIGGER IF NOT EXISTS log_rows_no_update BEFORE UPDATE ON log_rows
          WHEN EXISTS (SELECT 1 FROM append_only_logs WHERE log = OLD.log)
          BEGIN SELECT RAISE(ABORT, 'append-only log: rows cannot be changed'); END;
        CREATE TRIGGER IF NOT EXISTS log_rows_no_delete BEFORE DELETE ON log_rows
          WHEN EXISTS (SELECT 1 FROM append_only_logs WHERE log = OLD.log)
          BEGIN SELECT RAISE(ABORT, 'append-only log: rows cannot be removed'); END;
      `),
  },
  {
    version: 2,
    up: (db) =>
      db.exec(`
        CREATE TABLE collection_rows (coll TEXT NOT NULL, id TEXT NOT NULL, ord INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY (coll, id)) WITHOUT ROWID;
        CREATE INDEX collection_rows_order ON collection_rows (coll, ord);
      `),
  },
  {
    version: 3,
    up(db) {
      const logs = db
        .prepare("SELECT DISTINCT log FROM log_rows WHERE log IN ('jobs.jsonl','sessions.jsonl','lineage.jsonl') OR log LIKE '%/jobs.jsonl' OR log LIKE '%/sessions.jsonl' OR log LIKE '%/lineage.jsonl'")
        .all() as { log: string }[]
      const rows = db.prepare('SELECT line FROM log_rows WHERE log = ? ORDER BY seq')
      const put = db.prepare('INSERT INTO collection_rows (coll, id, ord, body) SELECT ?, ?, COALESCE(MAX(ord), 0) + 1, ? FROM collection_rows WHERE coll = ? ON CONFLICT(coll, id) DO UPDATE SET body = excluded.body')
      for (const { log } of logs) {
        for (const { line } of rows.all(log) as { line: string }[]) {
          try {
            const id = (JSON.parse(line) as { id?: unknown }).id
            if (typeof id === 'string' && id) put.run(log, id, line, log)
          } catch {
            /* corrupt line: skipped, as the readers did */
          }
        }
        db.prepare('DELETE FROM log_rows WHERE log = ?').run(log)
      }
    },
  },
]

function migrate(db: DatabaseSync, migrations: Migration[]): void {
  const current = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
  const latest = migrations.reduce((n, m) => Math.max(n, m.version), 0)
  if (current > latest) throw new Error(`Database schema v${current} is newer than this release (v${latest}); upgrade the BFF or restore an older backup`)
  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
    if (m.version <= current) continue
    db.exec('BEGIN IMMEDIATE')
    try {
      m.up(db)
      db.exec(`PRAGMA user_version = ${m.version}`)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
}

/**
 * Database adapter for the persistence seam. Documents and logs are keyed by their path relative to the
 * database directory, so the data survives a volume mounted elsewhere. One process writes; WAL with FULL
 * sync makes every acknowledged write durable. Opening checks integrity and applies pending schema steps.
 */
export function createSqliteBackend(dbPath: string, opts: { migrations?: Migration[] } = {}): SqliteBackend {
  const migrations = opts.migrations ?? MIGRATIONS
  const root = resolve(dirname(dbPath))
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const db = new DatabaseSync(dbPath)
  try {
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA busy_timeout = 5000;
    `)
    const quick = (db.prepare('PRAGMA quick_check').all() as { quick_check: string }[]).map((r) => r.quick_check)
    if (quick.length !== 1 || quick[0] !== 'ok') throw new Error(`Database integrity check failed: ${quick.slice(0, 3).join('; ')}`)
    migrate(db, migrations)
  } catch (error) {
    db.close()
    throw error
  }

  const keyOf = (path: string): string => {
    const abs = resolve(path)
    const rel = relative(root, abs)
    return rel && !rel.startsWith('..') && !rel.startsWith(sep) ? rel.split(sep).join('/') : abs
  }

  const getDoc = db.prepare('SELECT body FROM documents WHERE key = ?')
  const putDoc = db.prepare(
    'INSERT INTO documents (key, body, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at',
  )
  const putRow = db.prepare(
    'INSERT INTO log_rows (log, seq, line) SELECT ?, COALESCE(MAX(seq), 0) + 1, ? FROM log_rows WHERE log = ?',
  )
  const rowsAfter = db.prepare('SELECT seq, line FROM log_rows WHERE log = ? AND seq > ? ORDER BY seq')
  const maxSeq = db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM log_rows WHERE log = ?')
  const dropRows = db.prepare('DELETE FROM log_rows WHERE log = ?')
  // Prepared on first use so a database still on an older schema can open (and be migrated) before these tables exist.
  const lazy = (sql: string) => { let stmt: ReturnType<DatabaseSync['prepare']> | undefined; return () => (stmt ??= db.prepare(sql)) }
  const getRow = lazy('SELECT body FROM collection_rows WHERE coll = ? AND id = ?')
  const putRowStmt = lazy(
    'INSERT INTO collection_rows (coll, id, ord, body) SELECT ?, ?, COALESCE(MAX(ord), 0) + 1, ? FROM collection_rows WHERE coll = ? ON CONFLICT(coll, id) DO UPDATE SET body = excluded.body',
  )
  const delRow = lazy('DELETE FROM collection_rows WHERE coll = ? AND id = ?')
  const listRows = lazy('SELECT id, body FROM collection_rows WHERE coll = ? ORDER BY ord')
  const clearRows = lazy('DELETE FROM collection_rows WHERE coll = ?')

  let depth = 0
  const atomically = <R>(fn: () => R): R => {
    const name = `mice_${depth}`
    db.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${name}`)
    depth += 1
    try {
      const result = fn()
      depth -= 1
      db.exec(depth === 0 ? 'COMMIT' : `RELEASE ${name}`)
      return result
    } catch (error) {
      depth -= 1
      db.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${name}; RELEASE ${name}`)
      throw error
    }
  }

  const lines = (text: string): string[] => text.split('\n').map((l) => l.trim()).filter(Boolean)

  return {
    read: (path) => (getDoc.get(keyOf(path)) as { body: string } | undefined)?.body,
    write(path, text) {
      putDoc.run(keyOf(path), text, new Date().toISOString())
    },
    append(path, text) {
      const key = keyOf(path)
      atomically(() => {
        for (const line of lines(text)) putRow.run(key, line, key)
      })
    },
    readLines: (path, afterSeq) =>
      (rowsAfter.all(keyOf(path), afterSeq) as LogRow[]).map((r) => ({ seq: Number(r.seq), line: r.line })),
    lastSeq: (path) => Number((maxSeq.get(keyOf(path)) as { seq: number | bigint }).seq),
    rewriteLines(path, rows) {
      const key = keyOf(path)
      atomically(() => {
        dropRows.run(key)
        for (const line of rows) putRow.run(key, line, key)
      })
    },
    remove(path) {
      const key = keyOf(path)
      atomically(() => {
        db.prepare('DELETE FROM documents WHERE key = ?').run(key)
        dropRows.run(key)
      })
    },
    protectLog(path) {
      db.prepare('INSERT OR IGNORE INTO append_only_logs (log) VALUES (?)').run(keyOf(path))
    },
    unprotectLog(path) {
      db.prepare('DELETE FROM append_only_logs WHERE log = ?').run(keyOf(path))
    },
    rowGet: (coll, id) => (getRow().get(keyOf(coll), id) as { body: string } | undefined)?.body,
    rowPut(coll, id, body) {
      const key = keyOf(coll)
      putRowStmt().run(key, id, body, key)
    },
    rowRemove: (coll, id) => Number(delRow().run(keyOf(coll), id).changes) > 0,
    rowList: (coll) => listRows().all(keyOf(coll)) as { id: string; body: string }[],
    rowClear(coll) {
      clearRows().run(keyOf(coll))
    },
    atomically,
    close: () => db.close(),
    schemaVersion: () => Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version),
    latestSchemaVersion: migrations.reduce((n, m) => Math.max(n, m.version), 0),
    keys: () => [
      ...(db.prepare('SELECT key FROM documents').all() as { key: string }[]).map((r) => r.key),
      ...(db.prepare('SELECT DISTINCT log FROM log_rows').all() as { log: string }[]).map((r) => r.log),
    ],
    pragmas: () => ({
      journal_mode: String((db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode),
      synchronous: Number((db.prepare('PRAGMA synchronous').get() as { synchronous: number }).synchronous),
    }),
    backup(dest) {
      if (existsSync(dest)) throw new Error(`Backup target exists: ${dest}`)
      mkdirSync(dirname(resolve(dest)), { recursive: true, mode: 0o700 })
      db.prepare('VACUUM INTO ?').run(resolve(dest))
    },
    probe() {
      atomically(() => putDoc.run('.probe', '', new Date().toISOString()))
    },
  }
}
