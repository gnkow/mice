import './db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { isolatedAuth } from './testSupport.js'
import { queryAudit } from './audit.js'

const t = isolatedAuth({ AUTHZ_BOOTSTRAP_ADMINS: 'root@x.io' })
after(() => t.restore())

const { Hono } = await import('hono')
const { registerNamespaceRoutes } = await import('./namespaceRoutes.js')
const { auditMutation } = await import('./auditMutation.js')
const { preparePrincipal } = await import('./authz.js')
const { sealedSessionCookie } = await import('./testSupport.js')

const manager = t.person('manager')
await preparePrincipal(manager)
await t.grantRole(manager, 'manager')

const app = new Hono()
registerNamespaceRoutes(app, { audit: auditMutation })

const cookie = async () =>
  sealedSessionCookie({ ...manager, sessionStart: Math.floor(Date.now() / 1000) })

const reasonHeaders = {
  'content-type': 'application/json',
  'x-mice-reason': 'Routine settings correction for assay batch',
  'x-mice-reason-category': 'privileged_settings',
}

describe('change-control id on namespace mutations', () => {
  it('creates without a change-control id, refuses update without one, accepts a matching id', async () => {
    const ns = `cc-${Date.now().toString(36)}`
    const created = await app.request('/auth/namespaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: await cookie() },
      body: JSON.stringify({ name: ns, basePermission: 'read' }),
    })
    assert.equal(created.status, 200)

    const missing = await app.request(`/auth/namespaces/${ns}`, {
      method: 'PATCH',
      headers: { ...reasonHeaders, cookie: await cookie() },
      body: JSON.stringify({ membersCanCreateRepos: false }),
    })
    assert.equal(missing.status, 400)
    const missingBody = (await missing.json()) as { code?: string }
    assert.equal(missingBody.code, 'change_control_required')

    const bad = await app.request(`/auth/namespaces/${ns}`, {
      method: 'PATCH',
      headers: {
        ...reasonHeaders,
        'x-mice-change-control-id': '!!',
        cookie: await cookie(),
      },
      body: JSON.stringify({ membersCanCreateRepos: false }),
    })
    assert.equal(bad.status, 400)
    const badBody = (await bad.json()) as { code?: string }
    assert.equal(badBody.code, 'change_control_invalid')

    const ok = await app.request(`/auth/namespaces/${ns}`, {
      method: 'PATCH',
      headers: {
        ...reasonHeaders,
        'x-mice-change-control-id': 'CC-2026-114',
        cookie: await cookie(),
      },
      body: JSON.stringify({ membersCanCreateRepos: false }),
    })
    assert.equal(ok.status, 200)

    const events = (await queryAudit({ namespace: ns, action: 'namespace.settings.update', limit: 10 })).events
    assert.ok(events.some((e) => e.change_control_id === 'CC-2026-114'))
  })

  it('stores and enforces a custom per-namespace pattern', async () => {
    const ns = `ccpat-${Date.now().toString(36)}`
    assert.equal(
      (
        await app.request('/auth/namespaces', {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: await cookie() },
          body: JSON.stringify({ name: ns, basePermission: 'read' }),
        })
      ).status,
      200,
    )

    const pattern = await app.request(`/auth/namespaces/${ns}`, {
      method: 'PATCH',
      headers: {
        ...reasonHeaders,
        'x-mice-change-control-id': 'CC-2026-114',
        cookie: await cookie(),
      },
      body: JSON.stringify({ changeControlIdPattern: '^QMS-\\d{3}$' }),
    })
    assert.equal(pattern.status, 200)
    const body = (await pattern.json()) as {
      namespace: { changeControlIdPattern: string }
    }
    assert.equal(body.namespace.changeControlIdPattern, '^QMS-\\d{3}$')

    const refuse = await app.request(`/auth/namespaces/${ns}`, {
      method: 'PATCH',
      headers: {
        ...reasonHeaders,
        'x-mice-change-control-id': 'CC-2026-114',
        cookie: await cookie(),
      },
      body: JSON.stringify({ membersCanCreateRepos: true }),
    })
    assert.equal(refuse.status, 400)

    const accept = await app.request(`/auth/namespaces/${ns}`, {
      method: 'PATCH',
      headers: {
        ...reasonHeaders,
        'x-mice-change-control-id': 'QMS-042',
        cookie: await cookie(),
      },
      body: JSON.stringify({ membersCanCreateRepos: true }),
    })
    assert.equal(accept.status, 200)
  })
})
