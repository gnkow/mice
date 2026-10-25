import './db/testSchema.js'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-offboard-'))
process.env.SESSION_SECRET = 'test-session-secret-for-offboard'
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'root@x.io'

const { offboard } = await import('./offboarding.js')
const { createServicePrincipal, getServicePrincipal } = await import('./servicePrincipals.js')
const { queryAudit } = await import('./audit.js')
const { maybeBootstrapInstanceAdmin } = await import('./authzInstanceStore.js')

const mk = (sub: string) => ({ sub, iss: 'idp', email: `${sub}@x.io`, name: sub })
await maybeBootstrapInstanceAdmin({ ...mk('root'), emailVerified: true })

const mint = async (owner: ReturnType<typeof mk>) => {
  const r = await createServicePrincipal({ name: 'ci', owner })
  assert.ok(r.ok)
  return r.principal
}
await describe('offboard', async () => {
  await it('suspends owned service principals for directory-sync, audited with the cause', async () => {
    const owner = mk('owner')
    const sp = await mint(owner)
    const r = await offboard(owner, { scope: 'all', cause: 'directory-sync' })
    assert.ok(r.ok && r.suspended.length === 1)
    assert.equal((await getServicePrincipal(sp.id))?.suspendedAt !== undefined, true)
    assert.equal((await queryAudit({ action: 'service-principal.suspend' })).events[0]?.detail?.cause, 'directory-sync')
  })

  await it('does not suspend on sign-out or back-channel logout', async () => {
    const owner = mk('owner2')
    await mint(owner)
    for (const cause of ['self-service', 'back-channel-logout'] as const) {
      const r = await offboard(owner, { scope: 'sessions', cause })
      assert.ok(r.ok && r.suspended.length === 0)
    }
  })

  await it('refuses admin revocation by a non-admin and audits the denial', async () => {
    const r = await offboard(mk('victim'), { scope: 'all', cause: 'admin-revocation', actor: { ...mk('mallory') } })
    assert.deepEqual(r, { ok: false, error: 'Forbidden' })
    assert.equal((await queryAudit({ actor: 'mallory', action: 'session.revoke' })).events[0]?.status, 403)
  })
})
