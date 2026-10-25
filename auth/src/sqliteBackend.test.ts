import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { createSqliteBackend, MIGRATIONS, type Migration } from './sqliteBackend.js'
import { DatabaseSync } from 'node:sqlite'
import { openSync, writeSync, closeSync, statSync } from 'node:fs'
import { createAppendOnlyLog } from './stores.js'
import { useJsonBackend } from './jsonStore.js'

const dirs: string[] = []
const tmp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'mice-sqlite-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('sqlite backend', () => {
  it('keeps documents and logs across reopen', () => {
    const dir = tmp()
    const first = createSqliteBackend(join(dir, 'mice.db'))
    first.write(join(dir, 'pats.json'), '{"a":1}')
    first.append!(join(dir, 'audit.jsonl'), '{"n":1}\n')
    first.append!(join(dir, 'audit.jsonl'), '{"n":2}\n')
    first.close()
    const second = createSqliteBackend(join(dir, 'mice.db'))
    assert.equal(second.read(join(dir, 'pats.json')), '{"a":1}')
    assert.deepEqual(second.readLines(join(dir, 'audit.jsonl'), 0).map((r) => r.seq), [1, 2])
    assert.equal(second.lastSeq(join(dir, 'audit.jsonl')), 2)
    second.close()
  })

  it('keys rows by path relative to the database directory, so moving the volume keeps the data', () => {
    const dir = tmp()
    const moved = tmp()
    const a = createSqliteBackend(join(dir, 'mice.db'))
    a.write(join(dir, 'jobs', 'job-aliases.json'), '{}')
    a.close()
    rmSync(moved, { recursive: true, force: true })
    const b = createSqliteBackend(join(dir, 'mice.db'))
    assert.equal(b.read(join(dir, 'jobs', 'job-aliases.json')), '{}')
    assert.deepEqual(b.keys(), ['jobs/job-aliases.json'])
    b.close()
  })

  it('rolls back every write in a throwing atomically block and commits a clean one', () => {
    const dir = tmp()
    const db = createSqliteBackend(join(dir, 'mice.db'))
    db.write(join(dir, 'a.json'), '1')
    assert.throws(() => db.atomically(() => {
      db.write(join(dir, 'a.json'), '2')
      db.append!(join(dir, 'l.jsonl'), '{"x":1}\n')
      throw new Error('boom')
    }), /boom/)
    assert.equal(db.read(join(dir, 'a.json')), '1')
    assert.deepEqual(db.readLines(join(dir, 'l.jsonl'), 0), [])
    db.atomically(() => {
      db.write(join(dir, 'a.json'), '3')
      db.atomically(() => db.write(join(dir, 'b.json'), '4'))
    })
    assert.equal(db.read(join(dir, 'a.json')), '3')
    assert.equal(db.read(join(dir, 'b.json')), '4')
    db.close()
  })

  it('uses a write-ahead journal with full synchronous durability', () => {
    const dir = tmp()
    const db = createSqliteBackend(join(dir, 'mice.db'))
    assert.deepEqual(db.pragmas(), { journal_mode: 'wal', synchronous: 2 })
    db.close()
  })

  describe('append-only protection', () => {
    it('rejects rewrite and removal of a protected log at the storage level, but not of ordinary logs', () => {
      const dir = tmp()
      const db = createSqliteBackend(join(dir, 'mice.db'))
      const audit = join(dir, 'audit.jsonl')
      const other = join(dir, 'lineage.jsonl')
      db.protectLog(audit)
      db.append(audit, '{"n":1}\n')
      db.append(other, '{"n":1}\n')
      assert.throws(() => db.rewriteLines(audit, []), /append-only/)
      assert.throws(() => db.remove(audit), /append-only/)
      assert.deepEqual(db.readLines(audit, 0).map((r) => r.line), ['{"n":1}'])
      db.rewriteLines(other, [])
      db.append(audit, '{"n":2}\n')
      assert.equal(db.lastSeq(audit), 2)
      db.close()
    })

    it('keeps the protection across reopen and only a deliberate unprotect lifts it', () => {
      const dir = tmp()
      const audit = join(dir, 'audit.jsonl')
      const first = createSqliteBackend(join(dir, 'mice.db'))
      first.protectLog(audit)
      first.append(audit, '{"n":1}\n')
      first.close()
      const second = createSqliteBackend(join(dir, 'mice.db'))
      assert.throws(() => second.rewriteLines(audit, []), /append-only/)
      second.unprotectLog(audit)
      second.rewriteLines(audit, ['{"n":9}'])
      assert.deepEqual(second.readLines(audit, 0).map((r) => r.line), ['{"n":9}'])
      second.close()
    })

    it('protects every log created through the append-only interface', () => {
      const dir = tmp()
      const db = createSqliteBackend(join(dir, 'mice.db'))
      const restore = useJsonBackend(db)
      try {
        const log = createAppendOnlyLog<{ n: number }>(join(dir, 'audit-keys.jsonl'))
        log.append({ n: 1 })
        assert.throws(() => db.rewriteLines(join(dir, 'audit-keys.jsonl'), []), /append-only/)
        assert.equal(log.lastSeq(), 1)
      } finally {
        restore()
        db.close()
      }
    })
  })

  it('backs up a consistent copy with its protection intact while the source keeps working', () => {
    const dir = tmp()
    const db = createSqliteBackend(join(dir, 'mice.db'))
    const audit = join(dir, 'audit.jsonl')
    db.protectLog(audit)
    db.append(audit, '{"n":1}\n')
    db.write(join(dir, 'pats.json'), '{"a":1}')
    const target = tmp()
    const copy = join(target, 'mice.db')
    db.backup(copy)
    db.append(audit, '{"n":2}\n')
    const restored = createSqliteBackend(copy)
    assert.equal(restored.lastSeq(join(target, 'audit.jsonl')), 1)
    assert.equal(restored.read(join(target, 'pats.json')), '{"a":1}')
    assert.throws(() => restored.rewriteLines(join(target, 'audit.jsonl'), []), /append-only/)
    assert.throws(() => db.backup(copy), /exists/)
    restored.close()
    db.close()
  })

  it('probe fails once the database is closed', () => {
    const db = createSqliteBackend(join(tmp(), 'mice.db'))
    db.probe()
    db.close()
    assert.throws(() => db.probe())
  })

  describe('schema versions', () => {
    const base: Migration = MIGRATIONS[0]!

    it('a new database sits at the latest version', () => {
      const db = createSqliteBackend(join(tmp(), 'mice.db'))
      assert.equal(db.schemaVersion(), db.latestSchemaVersion)
      assert.ok(db.latestSchemaVersion >= 1)
      db.close()
    })

    it('migrates an older database once, keeping its data', () => {
      const path = join(tmp(), 'mice.db')
      const old = createSqliteBackend(path, { migrations: [base] })
      old.write(join(path, '..', 'pats.json'), '{"a":1}')
      old.close()
      const ran: number[] = []
      const next: Migration = { version: 2, up: (db) => { ran.push(2); db.exec('CREATE TABLE extra (id TEXT)') } }
      const upgraded = createSqliteBackend(path, { migrations: [base, next] })
      assert.equal(upgraded.schemaVersion(), 2)
      assert.equal(upgraded.read(join(path, '..', 'pats.json')), '{"a":1}')
      upgraded.close()
      createSqliteBackend(path, { migrations: [base, next] }).close()
      assert.deepEqual(ran, [2])
    })

    it('converts job, session and lineage log rows into collection rows, latest per id in first-seen order', () => {
      const path = join(tmp(), 'mice.db')
      const old = createSqliteBackend(path, { migrations: MIGRATIONS.slice(0, 2) })
      const jobs = join(path, '..', 'jobs', 'jobs.jsonl')
      for (const l of ['{"id":"a","v":1}', '{"id":"b"}', 'garbage', '{"id":"a","v":2}']) old.append(jobs, `${l}\n`)
      old.append(join(path, '..', 'audit.jsonl'), '{"id":"keep"}\n')
      old.close()
      const db = createSqliteBackend(path)
      assert.deepEqual(db.rowList(jobs).map((r) => r.body), ['{"id":"a","v":2}', '{"id":"b"}'])
      assert.equal(db.lastSeq(jobs), 0)
      assert.equal(db.lastSeq(join(path, '..', 'audit.jsonl')), 1)
      db.close()
    })

    it('a failing migration changes nothing and refuses to open', () => {
      const path = join(tmp(), 'mice.db')
      createSqliteBackend(path, { migrations: [base] }).close()
      const bad: Migration = { version: 2, up: (db) => { db.exec('CREATE TABLE half (id TEXT)'); throw new Error('boom') } }
      assert.throws(() => createSqliteBackend(path, { migrations: [base, bad] }), /boom/)
      const check = new DatabaseSync(path)
      assert.equal((check.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 1)
      assert.equal(check.prepare("SELECT name FROM sqlite_master WHERE name = 'half'").get(), undefined)
      check.close()
    })

    it('refuses a database written by a newer release', () => {
      const path = join(tmp(), 'mice.db')
      createSqliteBackend(path, { migrations: [base, { version: 2, up: () => {} }] }).close()
      assert.throws(() => createSqliteBackend(path, { migrations: [base] }), /newer/)
    })

    it('refuses to open a damaged database', () => {
      const path = join(tmp(), 'mice.db')
      const db = createSqliteBackend(path)
      for (let i = 0; i < 300; i++) db.write(join(path, '..', `d${i}.json`), 'x'.repeat(500))
      db.close()
      const fd = openSync(path, 'r+')
      const size = statSync(path).size
      writeSync(fd, Buffer.alloc(4096, 0xff), 0, 4096, Math.max(4096, size - 8192))
      closeSync(fd)
      assert.throws(() => createSqliteBackend(path), /malformed|integrity|corrupt|not a database/i)
    })
  })
})
