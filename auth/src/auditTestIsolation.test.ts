import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  allocateAuditKeyPrefix,
  installAuditKeyPrefix,
  ledgerEventsSince,
  ledgerHeadSeq,
  openIsolatedTestLedger,
} from './auditTestIsolation.js'

describe('audit test isolation', () => {
  it('allocates distinct private key prefixes', () => {
    const a = allocateAuditKeyPrefix('audit')
    const b = allocateAuditKeyPrefix('audit')
    assert.match(a, /^audit\/.+\/$/)
    assert.notEqual(a, b)
  })

  it('installs the prefix into IMMUDB_KEY_PREFIX for process-local ledger config', () => {
    const prev = process.env.IMMUDB_KEY_PREFIX
    const prefix = installAuditKeyPrefix()
    assert.equal(process.env.IMMUDB_KEY_PREFIX, prefix)
    process.env.IMMUDB_KEY_PREFIX = prev
  })

  it('opens ledgers under separate prefixes so concurrent writers do not share records', async () => {
    const a = await openIsolatedTestLedger()
    const b = await openIsolatedTestLedger()
    await a.ledger.append('only-a', JSON.stringify({ id: 'a', action: 'x', status: 200, path: '/', actor: { sub: 'a' } }))
    await b.ledger.append('only-b', JSON.stringify({ id: 'b', action: 'y', status: 200, path: '/', actor: { sub: 'b' } }))
    assert.deepEqual(
      (await a.ledger.readAll()).map((r) => r.value),
      [JSON.stringify({ id: 'a', action: 'x', status: 200, path: '/', actor: { sub: 'a' } })],
    )
    assert.deepEqual(
      (await b.ledger.readAll()).map((r) => r.value),
      [JSON.stringify({ id: 'b', action: 'y', status: 200, path: '/', actor: { sub: 'b' } })],
    )
    await a.ledger.close()
    await b.ledger.close()
  })

  it('scopes event reads to since + own actors and survives sibling close', async () => {
    const { ledger } = await openIsolatedTestLedger()
    const sibling = await openIsolatedTestLedger()
    await ledger.append(
      'other',
      JSON.stringify({ id: 'o', action: 'noise', status: 200, path: '/', actor: { sub: 'other' } }),
    )
    const since = await ledgerHeadSeq(ledger)
    await ledger.append(
      'mine',
      JSON.stringify({ id: 'm', action: 'keep', status: 200, path: '/api', actor: { sub: 'me' } }),
    )
    await sibling.ledger.append('sib', '{"n":1}')
    await sibling.ledger.close()

    const rows = await ledgerEventsSince(ledger, since, { actors: new Set(['me']) })
    assert.deepEqual(
      rows.map((r) => r.id),
      ['m'],
    )
    assert.equal((await ledger.verify()).ok, true)
    await ledger.close()
  })
})
