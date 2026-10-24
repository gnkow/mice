import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-revoke-'))
process.env.SESSION_SECRET = 'test-session-secret-for-revoke'
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'admin@x.io'

const { sealSession, openSession } = await import('./session.js')
const { revokeSessions } = await import('./credentialRevocation.js')
const { createPat, resolvePat } = await import('./tokens.js')
const authz = await import('./authzStore.js')

const mk = (sub: string, iss = 'idp-a') => ({ sub, iss, email: `${sub}@x.io`, name: sub })
const admin = mk('admin')
const target = mk('target')
const nowSec = () => Math.floor(Date.now() / 1000)

authz.maybeBootstrapInstanceAdmin({ ...admin, emailVerified: true })

describe('session revocation', () => {
  it('rejects non-admins', () => {
    const r = revokeSessions(mk('mallory'), target)
    assert.deepEqual(r, { ok: false, error: 'Forbidden' })
  })

  it('invalidates older Sessions of that Principal only', async () => {
    const old = await sealSession({ ...target, sessionStart: nowSec() - 60 })
    const other = await sealSession({ ...mk('target', 'idp-b'), sessionStart: nowSec() - 60 })
    const bystander = await sealSession({ ...mk('bystander'), sessionStart: nowSec() - 60 })
    assert.ok(await openSession(old))
    assert.deepEqual(revokeSessions(admin, target), { ok: true })
    assert.equal(await openSession(old), null)
    assert.ok(await openSession(other), 'same sub under another iss is unaffected')
    assert.ok(await openSession(bystander))
  })

  it('allows a fresh login after revocation', async () => {
    revokeSessions(admin, target)
    const fresh = await sealSession({ ...target, sessionStart: nowSec() + 2 })
    assert.ok(await openSession(fresh))
  })

  it('also cuts off PATs minted before the revocation, not later ones', async () => {
    const victim = mk('pat-victim')
    const { token: old } = createPat(victim, 'old')
    assert.ok(resolvePat(old))
    const realNow = Date.now
    try {
      revokeSessions(admin, victim)
      assert.equal(resolvePat(old), null)
      Date.now = () => realNow() + 2000
      const { token: fresh } = createPat(victim, 'fresh')
      assert.ok(resolvePat(fresh))
    } finally {
      Date.now = realNow
    }
  })
})
