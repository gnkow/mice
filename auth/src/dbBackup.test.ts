import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { createSqliteBackend, type SqliteBackend } from './sqliteBackend.js'
import { runDatabaseBackup, startDatabaseBackupSchedule } from './dbBackup.js'

const dirs: string[] = []
const open: SqliteBackend[] = []
afterEach(() => {
  while (open.length) open.pop()!.close()
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'mice-backup-'))
  dirs.push(dir)
  const db = createSqliteBackend(join(dir, 'mice.db'))
  open.push(db)
  db.write(join(dir, 'pats.json'), '{"a":1}')
  return { dir, db, backups: join(dir, 'backups') }
}

describe('database backups', () => {
  it('writes a verified copy that opens and holds the data', () => {
    const { dir, db, backups } = fixture()
    const file = runDatabaseBackup(db, { dir: backups, keep: 3, now: () => Date.UTC(2026, 0, 1) })
    const copy = new DatabaseSync(file, { readOnly: true })
    assert.equal((copy.prepare("SELECT body FROM documents WHERE key = 'pats.json'").get() as { body: string }).body, '{"a":1}')
    copy.close()
    assert.equal(dir.length > 0, true)
  })

  it('keeps only the newest N backups', () => {
    const { db, backups } = fixture()
    for (let i = 1; i <= 5; i++) runDatabaseBackup(db, { dir: backups, keep: 2, now: () => Date.UTC(2026, 0, i) })
    assert.equal(readdirSync(backups).filter((f) => f.endsWith('.db')).length, 2)
    assert.ok(readdirSync(backups).some((f) => f.includes('2026-01-05')))
  })

  it('throws and leaves no file when the copy fails verification', () => {
    const { db, backups } = fixture()
    const broken = Object.assign(Object.create(db), {
      backup: (dest: string) => writeFileSync(dest, 'not a database'),
    }) as SqliteBackend
    assert.throws(() => runDatabaseBackup(broken, { dir: backups, keep: 2, now: () => 1 }), /verif/i)
    assert.deepEqual(readdirSync(backups).filter((f) => f.endsWith('.db')), [])
  })

  it('a failed backup never prunes the good ones', () => {
    const { db, backups } = fixture()
    runDatabaseBackup(db, { dir: backups, keep: 1, now: () => Date.UTC(2026, 0, 1) })
    const broken = Object.assign(Object.create(db), { backup: (d: string) => writeFileSync(d, 'x') }) as SqliteBackend
    assert.throws(() => runDatabaseBackup(broken, { dir: backups, keep: 1, now: () => Date.UTC(2026, 0, 2) }))
    assert.equal(readdirSync(backups).filter((f) => f.endsWith('.db')).length, 1)
  })

  it('the schedule backs up once per interval and is off when the interval is zero', () => {
    const { db, backups } = fixture()
    let t = 0
    const clock = { now: () => t }
    const off = startDatabaseBackupSchedule(db, { dir: backups, keep: 3, intervalMs: 0, clock, poll: false })
    t = 10 ** 9
    assert.equal(off.tick(), false)
    assert.equal(existsSync(backups), false)
    const on = startDatabaseBackupSchedule(db, { dir: backups, keep: 3, intervalMs: 1000, clock, poll: false })
    assert.equal(on.tick(), false)
    t += 1000
    assert.equal(on.tick(), true)
    assert.equal(on.tick(), false)
    assert.equal(readdirSync(backups).filter((f) => f.endsWith('.db')).length, 1)
    on.stop()
  })
})
