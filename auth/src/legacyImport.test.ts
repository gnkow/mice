import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { importLegacyData } from './legacyImport.js'
import { createSqliteBackend, type SqliteBackend } from './sqliteBackend.js'

const dirs: string[] = []
const open: SqliteBackend[] = []
afterEach(() => {
  for (const db of open.splice(0)) db.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const AUDIT = '{"id":"a1","prev_hash":"0","hash":"h1"}\n{"id":"a2","prev_hash":"h1","hash":"h2"}\n'

function legacyDir(): { dir: string; db: SqliteBackend } {
  const dir = mkdtempSync(join(tmpdir(), 'mice-legacy-'))
  dirs.push(dir)
  mkdirSync(join(dir, 'jobs'), { recursive: true })
  mkdirSync(join(dir, 'sessions'), { recursive: true })
  writeFileSync(join(dir, 'pats.json'), '{"p":1}')
  writeFileSync(join(dir, 'jobs', 'job-aliases.json'), '{"j":2}')
  writeFileSync(join(dir, 'audit.jsonl'), AUDIT)
  writeFileSync(join(dir, 'lineage.jsonl'), '{"id":"l1"}\n\n{"id":"l2"}\n{"id":"l1","v":2}\n')
  writeFileSync(join(dir, 'sessions', 'sessions.jsonl'), '{"id":"s1"}\n')
  writeFileSync(join(dir, 'jobs', 'jobs.jsonl'), '{"id":"j1"}\n{bad\n{"id":"j2"}\n')
  const db = createSqliteBackend(join(dir, 'mice.db'))
  open.push(db)
  return { dir, db }
}

describe('legacy import', () => {
  it('imports documents and logs verbatim, protects the audit logs and archives the originals', () => {
    const { dir, db } = legacyDir()
    const report = importLegacyData(dir, db)
    assert.equal(report.imported, true)
    assert.equal(db.read(join(dir, 'pats.json')), '{"p":1}')
    assert.equal(db.read(join(dir, 'jobs', 'job-aliases.json')), '{"j":2}')
    assert.deepEqual(db.readLines(join(dir, 'audit.jsonl'), 0).map((r) => r.line + '\n').join(''), AUDIT)
    assert.deepEqual(db.rowList(join(dir, 'lineage.jsonl')).map((r) => r.body), ['{"id":"l1","v":2}', '{"id":"l2"}'])
    assert.equal(db.rowList(join(dir, 'sessions', 'sessions.jsonl')).length, 1)
    assert.deepEqual(db.rowList(join(dir, 'jobs', 'jobs.jsonl')).map((r) => r.id), ['j1', 'j2'])
    assert.equal(db.lastSeq(join(dir, 'lineage.jsonl')), 0)
    assert.throws(() => db.rewriteLines(join(dir, 'audit.jsonl'), []), /append-only/)
    assert.equal(existsSync(join(dir, 'pats.json')), false)
    assert.equal(readFileSync(join(dir, 'legacy-import', 'pats.json'), 'utf8'), '{"p":1}')
    assert.equal(readFileSync(join(dir, 'legacy-import', 'audit.jsonl'), 'utf8'), AUDIT)
  })

  it('is idempotent: a second boot imports nothing and a restored file is not re-imported', () => {
    const { dir, db } = legacyDir()
    importLegacyData(dir, db)
    writeFileSync(join(dir, 'pats.json'), '{"p":"stale"}')
    const again = importLegacyData(dir, db)
    assert.equal(again.imported, false)
    assert.equal(db.read(join(dir, 'pats.json')), '{"p":1}')
  })

  it('finishes archiving on the next boot when a previous one died after the import committed', () => {
    const { dir, db } = legacyDir()
    importLegacyData(dir, db)
    writeFileSync(join(dir, 'pats.json'), '{"p":"left-behind"}')
    importLegacyData(dir, db)
    assert.equal(existsSync(join(dir, 'pats.json')), false)
    assert.equal(db.read(join(dir, 'pats.json')), '{"p":1}')
    assert.equal(readFileSync(join(dir, 'legacy-import', 'pats.json'), 'utf8'), '{"p":1}')
  })

  it('does nothing on a fresh install', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mice-legacy-'))
    dirs.push(dir)
    const db = createSqliteBackend(join(dir, 'mice.db'))
    open.push(db)
    assert.equal(importLegacyData(dir, db).imported, false)
  })

  it('refuses to merge when the database already holds the same data, leaving the legacy files untouched', () => {
    const { dir, db } = legacyDir()
    db.append(join(dir, 'audit.jsonl'), '{"id":"fresh"}\n')
    assert.throws(() => importLegacyData(dir, db), /already holds/)
    assert.equal(readFileSync(join(dir, 'audit.jsonl'), 'utf8'), AUDIT)
    assert.equal(db.read(join(dir, 'pats.json')), undefined)
    assert.equal(existsSync(join(dir, 'legacy-import')), false)
  })

  it('drops an unterminated trailing line like the file readers did, and reports it', () => {
    const { dir, db } = legacyDir()
    writeFileSync(join(dir, 'lineage.jsonl'), '{"id":"l1"}\n{"id":')
    const report = importLegacyData(dir, db)
    assert.equal(db.rowList(join(dir, 'lineage.jsonl')).length, 1)
    assert.deepEqual(report.partialLines, ['lineage.jsonl'])
  })
})
