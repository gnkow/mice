import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-offboard-'))
process.env.SESSION_SECRET = 'test-session-secret-for-offboard'
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'root@x.io'

const { offboard } = await import('./offboarding.js')
const { queryAudit } = await import('../../audit.js')
const { maybeBootstrapInstanceAdmin } = await import('../../authzInstanceStore.js')

const mk = (sub: string) => ({ sub, iss: 'idp', email: `${sub}@x.io`, name: sub })
await maybeBootstrapInstanceAdmin({ ...mk('root'), emailVerified: true })

await describe('offboard', async () => {
  await it('does not look for service principals when a person is revoked', async () => {
    const r = await offboard(mk('owner'), { scope: 'all', cause: 'directory-sync' })
    assert.ok(r.ok)
    assert.deepEqual(r.suspended, [])
    assert.deepEqual(r.completed, ['revoke-credentials', 'audit-revocation'])
    assert.equal((await queryAudit({ action: 'service-principal.suspend' })).events.length, 0)
  })

  await it('does not suspend on sign-out or back-channel logout', async () => {
    for (const cause of ['self-service', 'back-channel-logout'] as const) {
      const r = await offboard(mk('owner2'), { scope: 'sessions', cause })
      assert.ok(r.ok)
      assert.deepEqual(r.suspended, [])
      assert.deepEqual(r.completed, ['revoke-credentials', 'audit-revocation'])
    }
  })

  await it('refuses admin revocation by a non-admin and audits the denial', async () => {
    const r = await offboard(mk('victim'), { scope: 'all', cause: 'admin-revocation', actor: { ...mk('mallory') } })
    assert.deepEqual(r, { ok: false, error: 'Forbidden' })
    assert.equal((await queryAudit({ actor: 'mallory', action: 'session.revoke' })).events[0]?.status, 403)
  })
})
