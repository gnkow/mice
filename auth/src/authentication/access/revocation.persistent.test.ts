import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, describe, it } from 'node:test'
import { immudbConfig, openLedger, type Ledger } from '../../auditLedger.js'
import { useAuditLedger } from '../../audit.js'

const { revokeAll, isRevoked } = await import('./revocation.js')

const prefix = `revocation-test/${randomBytes(4).toString('hex')}/`
const realLedger = await openLedger({ ...immudbConfig(), prefix })

after(async () => {
  useAuditLedger(realLedger)
  await realLedger.close()
})

const admin = { iss: 'idp', sub: 'admin' }
const target = { iss: 'idp', sub: `revoke-${randomBytes(4).toString('hex')}` }

await describe('revocation persistence', async () => {
  await it('does not revoke when the audit Intent cannot be appended', async () => {
    const broken: Ledger = {
      ...realLedger,
      append: async () => {
        throw new Error('audit unavailable')
      },
    }
    useAuditLedger(broken)
    try {
      await assert.rejects(
        revokeAll(target, { revokedBy: admin, reason: 'security incident' }),
        (err: unknown) => (err as { status?: number }).status === 503,
      )
    } finally {
      useAuditLedger(realLedger)
    }
    assert.equal(await isRevoked(target), false)
  })
})
