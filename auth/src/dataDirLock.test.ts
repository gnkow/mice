import './db/testSchema.js'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { acquireDataDirLock } from './dataDirLock.js'

function dir() {
  return mkdtempSync(join(tmpdir(), 'mice-lock-'))
}

describe('data directory lock', () => {
  it('refuses a second holder while the first process is alive', () => {
    const d = dir()
    const first = acquireDataDirLock(d, { pid: process.pid })
    assert.throws(() => acquireDataDirLock(d, { pid: process.pid + 1, isAlive: () => true }), /already in use/)
    first.release()
  })

  it('releases on clean shutdown so the next start succeeds', () => {
    const d = dir()
    acquireDataDirLock(d).release()
    assert.equal(existsSync(join(d, '.mice-auth.lock')), false)
    acquireDataDirLock(d).release()
  })

  it('recovers a stale lock left by a dead process', () => {
    const d = dir()
    writeFileSync(join(d, '.mice-auth.lock'), '999999')
    const lock = acquireDataDirLock(d, { pid: 4242, isAlive: () => false })
    assert.equal(readFileSync(join(d, '.mice-auth.lock'), 'utf8'), '4242')
    lock.release()
  })
})
