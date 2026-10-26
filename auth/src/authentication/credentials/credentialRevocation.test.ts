import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { fakeClock, useClock } from '../../clock.js'

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-revoke-'))
process.env.SESSION_SECRET = 'test-session-secret-for-revoke'
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'admin@x.io'

const { sealSession, openSession } = await import('../session/session.js')
const { offboard } = await import('./offboarding.js')
const { revokeSessionsFor, revokeSessionsOnlyFor, isCredentialRevoked } =
  await import('./credentialRevocation.js')
const { createPat, resolvePat } = await import('./tokens.js')
const authz = await import('../../authzInstanceStore.js')

const adminRevoke = (actor: { iss: string; sub: string }, target: { iss: string; sub: string }) =>
  offboard(target, { scope: 'all', cause: 'admin-revocation', actor: { ...actor, email: '', name: '' } })
const mk = (sub: string, iss = 'idp-a') => ({ sub, iss, email: `${sub}@x.io`, name: sub })
const admin = mk('admin')
const target = mk('target')
const nowSec = () => Math.floor(Date.now() / 1000)

await authz.maybeBootstrapInstanceAdmin({ ...admin, emailVerified: true })

await describe('session revocation', async () => {
  await it('rejects non-admins', async () => {
    const r = await adminRevoke(mk('mallory'), target)
    assert.deepEqual(r, { ok: false, error: 'Forbidden' })
  })

  await it('invalidates older Sessions of that Principal only', async () => {
    const old = await sealSession({ ...target, sessionStart: nowSec() - 60 })
    const other = await sealSession({ ...mk('target', 'idp-b'), sessionStart: nowSec() - 60 })
    const bystander = await sealSession({ ...mk('bystander'), sessionStart: nowSec() - 60 })
    assert.ok(await openSession(old))
    assert.equal((await adminRevoke(admin, target)).ok, true)
    assert.equal(await openSession(old), null)
    assert.ok(await openSession(other), 'same sub under another iss is unaffected')
    assert.ok(await openSession(bystander))
  })

  await it('allows a fresh login after revocation', async () => {
    await adminRevoke(admin, target)
    const fresh = await sealSession({ ...target, sessionStart: nowSec() + 2 })
    assert.ok(await openSession(fresh))
  })

  await it('also cuts off PATs minted before the revocation, not later ones', async () => {
    const victim = mk('pat-victim')
    const { token: old } = await createPat(victim, 'old')
    assert.ok(await resolvePat(old))
    const clock = fakeClock(Date.now())
    const restore = useClock(clock)
    try {
      await adminRevoke(admin, victim)
      assert.equal(await resolvePat(old), null)
      clock.advance(2000)
      const { token: fresh } = await createPat(victim, 'fresh')
      assert.ok(await resolvePat(fresh))
    } finally {
      restore()
    }
  })
})

await describe('two cut-offs', async () => {
  await it('a sessions-only cut-off ends Sessions but leaves PATs valid', async () => {
    const who = mk('sessions-only')
    const old = await sealSession({ ...who, sessionStart: nowSec() - 60 })
    const { token } = await createPat(who, 'keep')
    await revokeSessionsOnlyFor(who)
    assert.equal(await openSession(old), null)
    assert.ok(await resolvePat(token))
  })

  await it('a full cut-off ends Sessions and older PATs', async () => {
    const who = mk('full')
    const old = await sealSession({ ...who, sessionStart: nowSec() - 60 })
    const { token } = await createPat(who, 'gone')
    await revokeSessionsFor(who)
    assert.equal(await openSession(old), null)
    assert.equal(await resolvePat(token), null)
  })

  await it('never lowers an existing cut-off', async () => {
    const who = mk('monotonic')
    const clock = fakeClock(10_000_000)
    const restore = useClock(clock)
    try {
      const high = await revokeSessionsFor(who)
      clock.set(5_000_000)
      await revokeSessionsFor(who)
      await revokeSessionsOnlyFor(who)
      assert.equal(await isCredentialRevoked(who, 9_999, 'pat'), true)
      assert.equal(await isCredentialRevoked(who, high + 1, 'session'), false)
    } finally {
      restore()
    }
  })
})
