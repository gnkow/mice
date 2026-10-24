import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-sp-'))
process.env.SESSION_SECRET = 'test-secret-sp'
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'root@x.io'
process.env.OIDC_ISSUER_PUBLIC = 'idp'

const { Hono } = await import('hono')
const { applyGlobalGuards, requireAuth } = await import('./requireAuth.js')
const sp = await import('./servicePrincipals.js')
const { runDirectorySync } = await import('./directorySync.js')
const { checkServicePatExpiry } = await import('./servicePrincipalExpiry.js')
const { createPat, resolvePat, revokePat } = await import('./tokens.js')
const { appendAudit, queryAudit, actorFromUser } = await import('./audit.js')
const { isInstanceAdmin, addInstanceAdmin, maybeBootstrapInstanceAdmin } = await import('./authzStore.js')
const { revokeSessions } = await import('./credentialRevocation.js')
const { readNotificationState, notificationUserKey } = await import('./notificationsStore.js')
const { rememberNotificationUser } = await import('./notifications.js')
const { productionStartupProblems } = await import('./startupGate.js')

const human = (sub: string) => ({ sub, iss: 'idp', email: `${sub}@x.io`, name: sub })
maybeBootstrapInstanceAdmin({ ...human('root'), emailVerified: true })
const root = human('root')

const realNow = Date.now
afterEach(() => { Date.now = realNow })

const mint = (p: { id: string; name: string }, days?: number) =>
  createPat(sp.serviceUser(p as never), 'ci', { expiresInDays: days })

describe('service principals', () => {
  it('creates a principal with a required human owner under the reserved issuer', () => {
    assert.equal(sp.createServicePrincipal({ name: 'ci', owner: undefined as never }).ok, false)
    assert.equal(sp.createServicePrincipal({ name: '', owner: human('alice') }).ok, false)
    assert.equal(
      sp.createServicePrincipal({ name: 'x', owner: { ...human('s'), iss: sp.SERVICE_ISSUER } }).ok,
      false,
    )
    const r = sp.createServicePrincipal({ name: 'ci', owner: human('alice') })
    assert.ok(r.ok)
    assert.equal(r.principal.status, 'active')
    assert.equal(sp.serviceUser(r.principal).iss, 'urn:mice:service')
    assert.equal(sp.listServicePrincipals().some((p) => p.id === r.principal.id), true)
  })

  it('authenticates a service PAT with human expiry rules, and is never an instance admin', async () => {
    const r = sp.createServicePrincipal({ name: 'ci2', owner: human('alice') })
    assert.ok(r.ok)
    assert.throws(() => mint(r.principal, 366))
    const { token, pat } = mint(r.principal)
    assert.ok(pat.expiresAt)
    const app = new Hono()
    applyGlobalGuards(app)
    app.get('/w', async (c) => {
      const a = await requireAuth(c)
      return a ? c.json({ sub: a.user.sub, iss: a.user.iss }) : c.json({}, 401)
    })
    const res = await app.request('/w', { headers: { authorization: `Bearer ${token}` } })
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { sub: r.principal.id, iss: sp.SERVICE_ISSUER })
    const u = sp.serviceUser(r.principal)
    assert.equal(isInstanceAdmin(u), false)
    assert.equal(addInstanceAdmin(root, u).ok, false)
    assert.equal(isInstanceAdmin(u), false)
  })

  it('identifies the service principal and its owner in audit events', () => {
    const r = sp.createServicePrincipal({ name: 'ci3', owner: human('alice') })
    assert.ok(r.ok)
    appendAudit({
      actor: actorFromUser(sp.serviceUser(r.principal)), via: 'pat', method: 'POST',
      path: '/x', status: 200, action: 'file.write',
    })
    const ev = queryAudit({ actor: r.principal.id, limit: 5 }).events[0]
    assert.equal(ev.actorKind, 'service')
    assert.equal(ev.owner?.sub, 'alice')
    appendAudit({ actor: actorFromUser(human('bob') as never), via: 'pat', method: 'POST', path: '/x', status: 200, action: 'file.write' })
    assert.equal(queryAudit({ actor: 'bob', limit: 1 }).events[0].actorKind, undefined)
  })

  it('rejects the reserved service issuer as the OIDC issuer', () => {
    const p = productionStartupProblems({ OIDC_ISSUER: 'urn:mice:service' })
    assert.equal(p.length, 1)
    assert.match(p[0], /reserved/)
    assert.deepEqual(productionStartupProblems({ OIDC_ISSUER: 'http://keycloak:8080/realms/mice' }), [])
  })

  it('suspends on owner offboarding (directory sync), audits the cause, and rejects its PATs', async () => {
    const own = sp.createServicePrincipal({ name: 'ci4', owner: human('carol') })
    const other = sp.createServicePrincipal({ name: 'ci5', owner: human('dave') })
    assert.ok(own.ok && other.ok)
    createPat(human('carol'), 'cli')
    const a = mint(own.principal)
    const b = mint(other.principal)
    const result = await runDirectorySync({
      lookup: async (p) => (p.sub === 'carol' ? 'disabled' : 'enabled'),
    })
    assert.ok(result.ok)
    assert.equal(sp.getServicePrincipal(own.principal.id)?.status, 'suspended')
    assert.equal(sp.getServicePrincipal(other.principal.id)?.status, 'active')
    assert.equal(resolvePat(a.token), null)
    assert.ok(resolvePat(b.token))
    const ev = queryAudit({ action: 'service-principal.suspend', limit: 10 }).events
      .find((e) => e.detail?.id === own.principal.id)
    assert.ok(ev)
    assert.equal(ev.detail?.cause, 'directory-sync')
    assert.ok(sp.getServicePrincipal(own.principal.id)?.record)
  })

  it('suspends on admin revocation of the owner', () => {
    const r = sp.createServicePrincipal({ name: 'ci6', owner: human('erin') })
    assert.ok(r.ok)
    const t = mint(r.principal)
    assert.ok(revokeSessions(root, human('erin')).ok)
    assert.equal(sp.getServicePrincipal(r.principal.id)?.status, 'suspended')
    assert.equal(resolvePat(t.token), null)
  })

  it('reassigns and reactivates; the same PATs work again', () => {
    const r = sp.createServicePrincipal({ name: 'ci7', owner: human('frank') })
    assert.ok(r.ok)
    const t = mint(r.principal)
    sp.suspendOwnedBy(human('frank'), 'admin-revocation')
    assert.equal(resolvePat(t.token), null)
    assert.equal(sp.reassignServicePrincipal(r.principal.id, { ...human('x'), iss: sp.SERVICE_ISSUER }).ok, false)
    const re = sp.reassignServicePrincipal(r.principal.id, human('gina'))
    assert.ok(re.ok)
    assert.equal(sp.getServicePrincipal(r.principal.id)?.owner.sub, 'gina')
    assert.equal(sp.getServicePrincipal(r.principal.id)?.status, 'active')
    assert.ok(resolvePat(t.token))
  })

  it('never suspends a principal whose owner is still active', () => {
    const r = sp.createServicePrincipal({ name: 'ci8', owner: human('hank') })
    assert.ok(r.ok)
    assert.deepEqual(sp.suspendOwnedBy(human('someone-else'), 'directory-sync'), [])
    assert.equal(sp.getServicePrincipal(r.principal.id)?.status, 'active')
  })
})

describe('service principal PAT expiry notifications', () => {
  const inbox = (u: { iss: string; sub: string }) => {
    const s = readNotificationState()
    return s.entries.filter((e) => e.user === notificationUserKey(u)).map((e) => s.events[e.event])
  }

  it('notifies the owner once at the lead time, naming principal and date; redirects after reassign', () => {
    const t0 = realNow()
    Date.now = () => t0
    const owner = human('olga')
    rememberNotificationUser({ ...owner })
    const r = sp.createServicePrincipal({ name: 'deploy-bot', owner })
    assert.ok(r.ok)
    const { pat } = mint(r.principal, 20)
    assert.equal(checkServicePatExpiry(14), 0)
    Date.now = () => t0 + 7 * 86_400_000
    assert.equal(checkServicePatExpiry(14), 1)
    assert.equal(checkServicePatExpiry(14), 0)
    const got = inbox(owner).filter((n) => n.summary.includes('deploy-bot'))
    assert.equal(got.length, 1)
    assert.ok(got[0].summary.includes(pat.expiresAt!.slice(0, 10)))

    const next = human('pia')
    rememberNotificationUser({ ...next })
    sp.reassignServicePrincipal(r.principal.id, next)
    const { pat: later } = mint(r.principal, 10)
    assert.equal(checkServicePatExpiry(14), 1)
    assert.equal(inbox(next).filter((n) => n.summary.includes('deploy-bot')).length, 1)
    assert.ok(later.id)
  })

  it('skips expired and revoked PATs', () => {
    const t0 = realNow()
    Date.now = () => t0
    const r = sp.createServicePrincipal({ name: 'skip-bot', owner: human('quinn') })
    assert.ok(r.ok)
    mint(r.principal, 1)
    const revoked = mint(r.principal, 30)
    revokePat(sp.serviceUser(r.principal), revoked.pat.id)
    Date.now = () => t0 + 20 * 86_400_000
    assert.equal(checkServicePatExpiry(14), 0)
  })
})
