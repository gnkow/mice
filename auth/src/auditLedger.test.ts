import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { describe, it } from 'node:test'
import { immudbConfig, openLedger, type Ledger } from './auditLedger.js'

const prefix = `ledger-test/${randomBytes(4).toString('hex')}/`
const open = () => openLedger({ ...immudbConfig(), prefix })

describe('audit ledger on immudb', () => {
  it('returns appended records in append order with increasing sequence numbers', async () => {
    const ledger = await open()
    const first = await ledger.append('b-first', '{"n":1}')
    const second = await ledger.append('a-second', '{"n":2}')
    assert.ok(second > first)
    const records = await ledger.readAll()
    assert.deepEqual(
      records.map((r) => r.value),
      ['{"n":1}', '{"n":2}'],
    )
    assert.deepEqual(
      records.map((r) => r.seq),
      [first, second],
    )
    await ledger.close()
  })

  it('reads only what was written after a given sequence number', async () => {
    const ledger = await open()
    const first = await ledger.append('r1', '{"n":1}')
    const second = await ledger.append('r2', '{"n":2}')
    const after = await ledger.readAfter(first)
    assert.deepEqual(after.records.map((r) => [r.seq, r.value]), [[second, '{"n":2}']])
    assert.ok(after.scannedTo >= second)
    assert.deepEqual((await ledger.readAfter(after.scannedTo)).records, [])
    await ledger.close()
  })

  it('verifies an intact trail', async () => {
    const ledger = await open()
    await ledger.append('v1', '{"ok":true}')
    const v = await ledger.verify()
    assert.equal(v.ok, true)
    if (v.ok) assert.ok(v.events >= 1)
    await ledger.close()
  })

  it('verifies while another client appends to the same database', async () => {
    const ledger = await open()
    const sibling = await openLedger({
      ...immudbConfig(),
      prefix: `ledger-test/${randomBytes(4).toString('hex')}/`,
    })
    await ledger.append('concurrent-base', '{"ok":true}')
    const failures: string[] = []
    await Promise.all([
      (async () => {
        for (let i = 0; i < 40; i++) await sibling.append(`w-${i}`, `{"i":${i}}`)
      })(),
      (async () => {
        for (let i = 0; i < 20; i++) {
          const v = await ledger.verify()
          if (!v.ok) failures.push(v.firstBreak.reason)
        }
      })(),
    ])
    assert.deepEqual(failures, [])
    await sibling.close()
    await ledger.close()
  })

  it('detects a record whose stored value no longer matches its proof', async () => {
    const ledger = await open()
    await ledger.append('t1', '{"amount":1}')
    const v = await ledger.verify({ tamper: (r) => (r.key.endsWith('t1') ? { ...r, value: '{"amount":2}' } : r) })
    assert.equal(v.ok, false)
    if (!v.ok) assert.match(v.firstBreak.reason, /value/)
    await ledger.close()
  })

  it('detects a broken link in the transaction chain', async () => {
    const ledger = await open()
    await ledger.append('c1', '1')
    await ledger.append('c2', '2')
    const v = await ledger.verify({ tamperTx: (tx, i) => (i === 1 ? { ...tx, metadata: { ...tx.metadata, prevalh: Buffer.alloc(32).toString('base64') } } : tx) })
    assert.equal(v.ok, false)
    if (!v.ok) assert.match(v.firstBreak.reason, /chain/)
    await ledger.close()
  })

  it('reports an unreachable server as a failure, not a throw', async () => {
    const ledger: Ledger = await openLedger({ ...immudbConfig(), port: 1, prefix, lazy: true })
    await assert.rejects(ledger.append('x', 'y'))
    const h = await ledger.health()
    assert.equal(h.ok, false)
    await ledger.close()
  })
})
