import './db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { breakTable } from './db/testDatabase.js'
import { isolatedAuth } from './testSupport.js'

const ctx = isolatedAuth({ OIDC_ISSUER_PUBLIC: 'idp' })
after(() => ctx.restore())

const { runDirectorySync } = await import('./directorySync.js')
const { createPat } = await import('./tokens.js')
const { isCredentialRevoked } = await import('./credentialRevocation.js')
const { queryAudit } = await import('./audit.js')

const gone = { sub: 'leaver', iss: 'idp', email: 'leaver@x.io', name: 'leaver' }
const lookup = async () => 'missing' as const

describe('directory sync acts on the offboarding result', () => {
  it('reports an incomplete offboarding, audits it, and retries it on the next run', async () => {
    await createPat(gone, 'cli')
    const restore = await breakTable('session_revocations')
    let first
    try {
      first = await runDirectorySync({ lookup })
    } finally {
      await restore()
    }
    assert.ok(first.ok)
    assert.deepEqual(first.revoked, [])
    assert.equal(first.incomplete.length, 1)
    assert.equal(first.incomplete[0]!.sub, 'leaver')
    assert.deepEqual(first.incomplete[0]!.failed.map((f) => f.step), ['revoke-credentials', 'audit-revocation'])
    const ev = (await queryAudit({ action: 'directory.sync.failed' })).events[0]!
    assert.equal(ev.status, 500)
    assert.match(ev.message ?? '', /leaver/)

    const retry = await runDirectorySync({ lookup })
    assert.ok(retry.ok)
    assert.deepEqual(retry.revoked, [{ sub: 'leaver', iss: 'idp' }])
    assert.deepEqual(retry.incomplete, [])
    assert.equal(await isCredentialRevoked(gone, 0, 'session'), true)
  })
})
