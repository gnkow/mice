import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { systemClock, type Clock } from './clock.js'
import type { SqliteBackend } from './sqliteBackend.js'

export type BackupOptions = { dir: string; keep: number; now?: () => number }

const BACKUP_FILE = /^mice-.*\.db$/

/** A copy only counts once it opens, passes the integrity check and carries the source's schema version. */
function verify(file: string, expectedVersion: number): void {
  let copy: DatabaseSync | undefined
  try {
    copy = new DatabaseSync(file, { readOnly: true })
    const quick = (copy.prepare('PRAGMA quick_check').all() as { quick_check: string }[]).map((r) => r.quick_check)
    const version = (copy.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    if (quick.length !== 1 || quick[0] !== 'ok' || version !== expectedVersion) throw new Error(quick.join('; ') || `schema v${version}`)
  } catch (error) {
    throw new Error(`Backup verification failed for ${file}: ${(error as Error).message}`)
  } finally {
    copy?.close()
  }
}

/** Consistent online copy, verified, then older copies beyond `keep` are removed. A failed copy is deleted and nothing is pruned. */
export function runDatabaseBackup(db: SqliteBackend, opts: BackupOptions): string {
  const stamp = new Date((opts.now ?? Date.now)()).toISOString().replace(/[:.]/g, '-')
  mkdirSync(opts.dir, { recursive: true, mode: 0o700 })
  const file = join(opts.dir, `mice-${stamp}.db`)
  try {
    db.backup(file)
    verify(file, db.schemaVersion())
  } catch (error) {
    if (existsSync(file)) rmSync(file, { force: true })
    throw error
  }
  const all = readdirSync(opts.dir).filter((f) => BACKUP_FILE.test(f)).sort()
  for (const old of all.slice(0, Math.max(0, all.length - Math.max(1, opts.keep)))) rmSync(join(opts.dir, old), { force: true })
  return file
}

/** Off when `intervalMs` is 0. Failures are logged, never fatal: serving beats backing up. */
export function startDatabaseBackupSchedule(
  db: SqliteBackend,
  opts: BackupOptions & { intervalMs: number; clock?: Clock; poll?: boolean },
): { tick(): boolean; stop(): void } {
  const clock = opts.clock ?? systemClock
  if (opts.intervalMs <= 0) return { tick: () => false, stop() {} }
  let last = clock.now()
  const tick = (): boolean => {
    if (clock.now() - last < opts.intervalMs) return false
    last = clock.now()
    try {
      runDatabaseBackup(db, { ...opts, now: () => clock.now() })
    } catch (err) {
      console.error('[mice-auth] database backup failed', err)
    }
    return true
  }
  const timer = opts.poll === false ? undefined : setInterval(tick, Math.min(opts.intervalMs, 60_000))
  timer?.unref()
  return { tick, stop: () => clearInterval(timer) }
}
