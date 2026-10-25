import './db/testSchema.js'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, afterEach, describe, it } from 'node:test'

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-sp-'))
process.env.SESSION_SECRET = 'test-secret-sp'
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'root@x.io'
process.env.OIDC_ISSUER_PUBLIC = 'idp'

const { Hono } = await import('hono')
const { applyGlobalGuards, authenticateRequest } = await import('./requireAuth.js')
const { SERVICE_ISSUER } = await import('./principal.js')
const sp = await import('./servicePrincipals.js')
const { runDirectorySync } = await import('./directorySync.js')
const { checkServicePatExpiry } = await import('./servicePrincipalExpiry.js')
const { createPat, resolvePat, revokePat } = await import('./tokens.js')
const { appendAudit, queryAudit, actorFromUser } = await import('./audit.js')
const { isInstanceAdmin, addInstanceAdmin, maybeBootstrapInstanceAdmin } = await import('./authzInstanceStore.js')
const { offboard } = await import('./offboarding.js')
const { novuInbox } = await import('./testSupport.js')
const { purgeTouchedSubscribers } = await import('./novu.js')
const { rememberNotificationUser } = await import('./notifications.js')
const { productionStartupProblems } = await import('./startupGate.js')

const adminRevoke = (actor: { iss: string; sub: string }, target: { iss: string; sub: string }) =>
  offboard(target, { scope: 'all', cause: 'admin-revocation', actor: { ...actor, email: '', name: '' } })
const human = (sub: string) => ({ sub, iss: 'idp', email: `${sub}@x.io`, name: sub })
await maybeBootstrapInstanceAdmin({ ...human('root'), emailVerified: true })
const root = human('root')

const realNow = Date.now
afterEach(() => { Date.now = realNow })

const mint = (p: { id: string; name: string }, days?: number) =>
  createPat(sp.serviceUser(p as never), 'ci', { expiresInDays: days })

await describe('service principals', async () => {
  await it('creates a principal with a required human owner under the reserved issuer', async () => {
    assert.equal((await sp.createServicePrincipal({ name: 'ci', owner: undefined as never })).ok, false)
    assert.equal((await sp.createServicePrincipal({ name: '', owner: human('alice') })).ok, false)
    assert.equal(
      (await sp.createServicePrincipal({ name: 'x', owner: { ...human('s'), iss: SERVICE_ISSUER } })).ok,
      false,
    )
    const r = await sp.createServicePrincipal({ name: 'ci', owner: human('alice') })
    assert.ok(r.ok)
    assert.equal(r.principal.status, 'active')
    assert.equal(sp.serviceUser(r.principal).iss, 'urn:mice:service')
    assert.equal(((await sp.listServicePrincipals()).some((p) => p.id === r.principal.id)), true)
  })

  await it('authenticates a service PAT with human expiry rules, and is never an instance admin', async () => {
    const r = await sp.createServicePrincipal({ name: 'ci2', owner: human('alice') })
    assert.ok(r.ok)
    await assert.rejects(mint(r.principal, 366))
    const { token, pat } = await mint(r.principal)
    assert.ok(pat.expiresAt)
    const app = new Hono()
    applyGlobalGuards(app)
    app.get('/w', async (c) => {
      const a = await authenticateRequest(c, { allowScoped: true })
      return a ? c.json({ sub: a.user.sub, iss: a.user.iss }) : c.json({}, 401)
    })
    const res = await app.request('/w', { headers: { authorization: `Bearer ${token}` } })
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { sub: r.principal.id, iss: SERVICE_ISSUER })
    const u = sp.serviceUser(r.principal)
    assert.equal(await isInstanceAdmin(u), false)
    assert.equal((await addInstanceAdmin(root, u)).ok, false)
    assert.equal(await isInstanceAdmin(u), false)
  })

  await it('identifies the service principal and its owner in audit events', async () => {
    const r = await sp.createServicePrincipal({ name: 'ci3', owner: human('alice') })
    assert.ok(r.ok)
    await appendAudit({
      actor: actorFromUser(sp.serviceUser(r.principal)), via: 'pat', method: 'POST',
      path: '/x', status: 200, action: 'file.write',
    })
    const ev = (await queryAudit({ actor: r.principal.id, limit: 5 })).events[0]
    assert.equal(ev.actorKind, 'service')
    assert.equal(ev.owner?.sub, 'alice')
    await appendAudit({ actor: actorFromUser(human('bob') as never), via: 'pat', method: 'POST', path: '/x', status: 200, action: 'file.write' })
    assert.equal((await queryAudit({ actor: 'bob', limit: 1 })).events[0].actorKind, undefined)
  })

  await it('rejects the reserved service issuer as the OIDC issuer', () => {
    const p = productionStartupProblems({ OIDC_ISSUER: 'urn:mice:service' })
    assert.equal(p.length, 1)
    assert.match(p[0], /reserved/)
    assert.deepEqual(productionStartupProblems({ OIDC_ISSUER: 'http://keycloak:8080/realms/mice' }), [])
  })

  await it('suspends on owner offboarding (directory sync), audits the cause, and rejects its PATs', async () => {
    const own = await sp.createServicePrincipal({ name: 'ci4', owner: human('carol') })
    const other = await sp.createServicePrincipal({ name: 'ci5', owner: human('dave') })
    assert.ok(own.ok && other.ok)
    await createPat(human('carol'), 'cli')
    const a = await mint(own.principal)
    const b = await mint(other.principal)
    const result = await runDirectorySync({
      lookup: async (p) => (p.sub === 'carol' ? 'disabled' : 'enabled'),
    })
    assert.ok(result.ok)
    assert.equal((await sp.getServicePrincipal(own.principal.id))?.status, 'suspended')
    assert.equal((await sp.getServicePrincipal(other.principal.id))?.status, 'active')
    assert.equal(await resolvePat(a.token), null)
    assert.ok(await resolvePat(b.token))
    const ev = (await queryAudit({ action: 'service-principal.suspend', limit: 10 })).events
      .find((e) => e.detail?.id === own.principal.id)
    assert.ok(ev)
    assert.equal(ev.detail?.cause, 'directory-sync')
    assert.ok((await sp.getServicePrincipal(own.principal.id))?.record)
  })

  await it("suspends on admin revocation of the owner", async () => {
    const r = await sp.createServicePrincipal({ name: 'ci6', owner: human('erin') })
    assert.ok(r.ok)
    const t = await mint(r.principal)
    assert.ok((await adminRevoke(root, human('erin'))).ok)
    assert.equal((await sp.getServicePrincipal(r.principal.id))?.status, 'suspended')
    assert.equal(await resolvePat(t.token), null)
  })

  await it('reassigns and reactivates; the same PATs work again', async () => {
    const r = await sp.createServicePrincipal({ name: 'ci7', owner: human('frank') })
    assert.ok(r.ok)
    const t = await mint(r.principal)
    await sp.suspendOwnedBy(human('frank'), 'admin-revocation')
    assert.equal(await resolvePat(t.token), null)
    assert.equal((await sp.reassignServicePrincipal(r.principal.id, { ...human('x'), iss: SERVICE_ISSUER })).ok, false)
    const re = await sp.reassignServicePrincipal(r.principal.id, human('gina'))
    assert.ok(re.ok)
    assert.equal((await sp.getServicePrincipal(r.principal.id))?.owner.sub, 'gina')
    assert.equal((await sp.getServicePrincipal(r.principal.id))?.status, 'active')
    assert.ok(await resolvePat(t.token))
  })

  await it('never suspends a principal whose owner is still active', async () => {
    const r = await sp.createServicePrincipal({ name: 'ci8', owner: human('hank') })
    assert.ok(r.ok)
    assert.deepEqual(await sp.suspendOwnedBy(human('someone-else'), 'directory-sync'), [])
    assert.equal((await sp.getServicePrincipal(r.principal.id))?.status, 'active')
  })
})

await describe('service principal PAT expiry notifications', async () => {
  const inbox = novuInbox
  after(purgeTouchedSubscribers)

  await it('notifies the owner once at the lead time, naming principal and date; redirects after reassign', async () => {
    const t0 = realNow()
    Date.now = () => t0
    const owner = human('olga')
    await rememberNotificationUser({ ...owner })
    const r = await sp.createServicePrincipal({ name: 'deploy-bot', owner })
    assert.ok(r.ok)
    const { pat } = await mint(r.principal, 20)
    assert.equal(await checkServicePatExpiry(14), 0)
    Date.now = () => t0 + 7 * 86_400_000
    assert.equal(await checkServicePatExpiry(14), 1)
    assert.equal(await checkServicePatExpiry(14), 0)
    const got = (await inbox(owner, 1)).filter((n) => n.summary.includes('deploy-bot'))
    assert.equal(got.length, 1)
    assert.ok(got[0].summary.includes(pat.expiresAt!.slice(0, 10)))

    const next = human('pia')
    await rememberNotificationUser({ ...next })
    await sp.reassignServicePrincipal(r.principal.id, next)
    const { pat: later } = await mint(r.principal, 10)
    assert.equal(await checkServicePatExpiry(14), 1)
    assert.equal((await inbox(next, 1)).filter((n) => n.summary.includes('deploy-bot')).length, 1)
    assert.ok(later.id)
  })

  await it('skips expired and revoked PATs', async () => {
    const t0 = realNow()
    Date.now = () => t0
    const r = await sp.createServicePrincipal({ name: 'skip-bot', owner: human('quinn') })
    assert.ok(r.ok)
    await mint(r.principal, 1)
    const revoked = await mint(r.principal, 30)
    await revokePat(sp.serviceUser(r.principal), revoked.pat.id)
    Date.now = () => t0 + 20 * 86_400_000
    assert.equal(await checkServicePatExpiry(14), 0)
  })
})
