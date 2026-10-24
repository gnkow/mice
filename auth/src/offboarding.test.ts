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
const { maybeBootstrapInstanceAdmin } = await import('./authzStore.js')

const mk = (sub: string) => ({ sub, iss: 'idp', email: `${sub}@x.io`, name: sub })
maybeBootstrapInstanceAdmin({ ...mk('root'), emailVerified: true })

const mint = (owner: ReturnType<typeof mk>) => {
  const r = createServicePrincipal({ name: 'ci', owner })
  assert.ok(r.ok)
  return r.principal
}
describe('offboard', () => {
  it('suspends owned service principals for directory-sync, audited with the cause', () => {
    const owner = mk('owner')
    const sp = mint(owner)
    const r = offboard(owner, { scope: 'all', cause: 'directory-sync' })
    assert.ok(r.ok && r.suspended.length === 1)
    assert.equal(getServicePrincipal(sp.id)?.suspendedAt !== undefined, true)
    assert.equal(queryAudit({ action: 'service-principal.suspend' }).events[0]?.detail?.cause, 'directory-sync')
  })

  it('does not suspend on sign-out or back-channel logout', () => {
    const owner = mk('owner2')
    mint(owner)
    for (const cause of ['self-service', 'back-channel-logout'] as const) {
      const r = offboard(owner, { scope: 'sessions', cause })
      assert.ok(r.ok && r.suspended.length === 0)
    }
  })

  it('refuses admin revocation by a non-admin and audits the denial', () => {
    const r = offboard(mk('victim'), { scope: 'all', cause: 'admin-revocation', actor: { ...mk('mallory') } })
    assert.deepEqual(r, { ok: false, error: 'Forbidden' })
    assert.equal(queryAudit({ actor: 'mallory', action: 'session.revoke' }).events[0]?.status, 403)
  })
})
