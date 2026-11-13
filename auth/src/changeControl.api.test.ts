import './db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { isolatedAuth, regulatedMutationHeaders } from './testSupport.js'
import { queryAudit } from './audit.js'

const t = isolatedAuth({ AUTHZ_BOOTSTRAP_ADMINS: 'root@x.io' })
after(() => t.restore())

const { Hono } = await import('hono')
const { registerNamespaceRoutes } = await import('./namespaceRoutes.js')
const { auditMutation } = await import('./auditMutation.js')
const { preparePrincipal } = await import('./authz.js')
const { sealedSessionCookie } = await import('./testSupport.js')
const { openSignatureStore, useSignatureStore } = await import('./authentication/signing/signatureStore.js')
const { immudbConfig, openLedger } = await import('./auditLedger.js')
const { randomBytes } = await import('node:crypto')

const store = openSignatureStore(
  await openLedger({ ...immudbConfig(), prefix: `cc-api/${randomBytes(4).toString('hex')}/` }),
)
useSignatureStore(store)

const manager = t.person('manager')
await preparePrincipal(manager)
await t.grantRole(manager, 'manager')

const app = new Hono()
registerNamespaceRoutes(app, { audit: auditMutation })

const cookie = async () =>
  sealedSessionCookie({ ...manager, sessionStart: Math.floor(Date.now() / 1000) })

describe('change-control id on namespace mutations', () => {
  it('creates without a change-control id; updates mint or keep a client id', async () => {
    const ns = `cc-${Date.now().toString(36)}`
    const created = await app.request('/auth/namespaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: await cookie() },
      body: JSON.stringify({ name: ns, basePermission: 'read' }),
    })
    assert.equal(created.status, 200)

    const path = `/auth/namespaces/${ns}`
    const body1 = { membersCanCreateRepos: false }
    const mintedHeaders = await regulatedMutationHeaders(manager, {
      method: 'PATCH',
      path,
      body: body1,
    })
    const minted = await app.request(path, {
      method: 'PATCH',
      headers: { ...mintedHeaders, cookie: await cookie() },
      body: JSON.stringify(body1),
    })
    assert.equal(minted.status, 200)
    const mintedEvents = (await queryAudit({ namespace: ns, action: 'namespace.settings.update', limit: 10 })).events
    assert.ok(mintedEvents.some((e) => /^CC-\d{8}-[0-9a-f]{8}$/.test(e.change_control_id ?? '')))

    const body2 = { membersCanCreateRepos: true }
    const clientHeaders = await regulatedMutationHeaders(manager, {
      method: 'PATCH',
      path,
      body: body2,
    })
    const ok = await app.request(path, {
      method: 'PATCH',
      headers: {
        ...clientHeaders,
        'x-mice-change-control-id': 'CC-2026-114',
        cookie: await cookie(),
      },
      body: JSON.stringify(body2),
    })
    assert.equal(ok.status, 200)

    const events = (await queryAudit({ namespace: ns, action: 'namespace.settings.update', limit: 10 })).events
    assert.ok(events.some((e) => e.change_control_id === 'CC-2026-114'))
  })
})
