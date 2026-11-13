import './db/testSchema.js'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  backupTargetProblems,
  evaluateBackupTarget,
  recordBackupTargetCheck,
} from './backupTarget.js'
import { immudbConfig, openLedger } from './auditLedger.js'
import { initAudit, queryAudit, useAuditLedger } from './audit.js'

describe('backup target start gate', () => {
  it('rejects a missing or blank target', () => {
    for (const target of [undefined, '', '  ']) {
      const p = backupTargetProblems(target)
      assert.equal(p.length, 1, String(target))
      assert.match(p[0]!, /BACKUP_TARGET/)
    }
  })

  it('accepts a writable directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mice-backup-ok-'))
    assert.deepEqual(backupTargetProblems(dir), [])
    assert.deepEqual(evaluateBackupTarget(dir), { ok: true, target: dir })
  })

  it('evaluateBackupTarget shares the gate failure shape', () => {
    const ev = evaluateBackupTarget(undefined)
    assert.equal(ev.ok, false)
    if (!ev.ok) assert.match(ev.problems[0]!, /BACKUP_TARGET/)
  })

  it('rejects an unreachable target', () => {
    const parent = mkdtempSync(join(tmpdir(), 'mice-backup-ro-'))
    chmodSync(parent, 0o500)
    const target = join(parent, 'child')
    try {
      if (process.getuid?.() === 0) return
      const p = backupTargetProblems(target)
      assert.equal(p.length, 1)
      assert.match(p[0]!, /BACKUP_TARGET/)
    } finally {
      chmodSync(parent, 0o700)
    }
  })

  it('rejects a path that is a file, not a directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mice-backup-file-'))
    const file = join(dir, 'not-a-dir')
    writeFileSync(file, 'x')
    const p = backupTargetProblems(file)
    assert.equal(p.length, 1)
    assert.match(p[0]!, /BACKUP_TARGET/)
  })

  it('records a successful check in the audit trail', async () => {
    useAuditLedger(await openLedger(immudbConfig()))
    await initAudit()
    const dir = mkdtempSync(join(tmpdir(), 'mice-backup-record-'))
    await recordBackupTargetCheck(dir)
    const { events } = await queryAudit({ action: 'system.backup_target.check', limit: 5 })
    assert.ok(events.some((e) => e.action === 'system.backup_target.check' && e.detail?.target === dir))
  })
})
