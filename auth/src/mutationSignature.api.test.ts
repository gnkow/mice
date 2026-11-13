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
  await openLedger({ ...immudbConfig(), prefix: `esign-mut/${randomBytes(4).toString('hex')}/` }),
)
useSignatureStore(store)

const manager = t.person('manager')
await preparePrincipal(manager)
await t.grantRole(manager, 'manager')

const app = new Hono()
registerNamespaceRoutes(app, { audit: auditMutation })

const cookie = async () =>
  sealedSessionCookie({ ...manager, sessionStart: Math.floor(Date.now() / 1000) })

describe('electronic signature on regulated namespace mutations', () => {
  it('creates without a signature and refuses update without one', async () => {
    const ns = `esig-${Date.now().toString(36)}`
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

    const missing = await app.request(`/auth/namespaces/${ns}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-mice-reason': 'Routine settings correction for assay batch',
        'x-mice-reason-category': 'privileged_settings',
        cookie: await cookie(),
      },
      body: JSON.stringify({ membersCanCreateRepos: false }),
    })
    assert.equal(missing.status, 400)
    const missingBody = (await missing.json()) as { code?: string }
    assert.equal(missingBody.code, 'signature_required')
  })

  it('accepts a matching signature and refuses reuse', async () => {
    const ns = `esigok-${Date.now().toString(36)}`
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

    const path = `/auth/namespaces/${ns}`
    const body = { membersCanCreateRepos: false }
    const headers = await regulatedMutationHeaders(manager, {
      method: 'PATCH',
      path,
      body,
    })
    const ok = await app.request(path, {
      method: 'PATCH',
      headers: { ...headers, cookie: await cookie() },
      body: JSON.stringify(body),
    })
    assert.equal(ok.status, 200)

    const events = (await queryAudit({ namespace: ns, action: 'namespace.settings.update', limit: 10 }))
      .events
    assert.ok(events.some((e) => e.signature_id === headers['x-mice-signature-id']))

    const reuse = await app.request(path, {
      method: 'PATCH',
      headers: { ...headers, cookie: await cookie() },
      body: JSON.stringify({ membersCanCreateRepos: true }),
    })
    assert.equal(reuse.status, 400)
    assert.equal(((await reuse.json()) as { code?: string }).code, 'signature_invalid')
  })

  it('updates description when the signed body matches', async () => {
    const ns = `esigdesc-${Date.now().toString(36)}`
    assert.equal(
      (
        await app.request('/auth/namespaces', {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: await cookie() },
          body: JSON.stringify({
            name: ns,
            description: 'Before',
            basePermission: 'read',
          }),
        })
      ).status,
      200,
    )

    const path = `/auth/namespaces/${ns}`
    const body = { description: 'After signature' }
    const headers = await regulatedMutationHeaders(manager, { method: 'PATCH', path, body })
    const res = await app.request(path, {
      method: 'PATCH',
      headers: { ...headers, cookie: await cookie() },
      body: JSON.stringify(body),
    })
    assert.equal(res.status, 200)
    const got = (await res.json()) as { namespace: { description: string } }
    assert.equal(got.namespace.description, 'After signature')

    const detail = await app.request(path, {
      method: 'GET',
      headers: { cookie: await cookie() },
    })
    assert.equal(detail.status, 200)
    assert.equal(((await detail.json()) as { description: string }).description, 'After signature')
  })

  it('refuses a signature whose content hash does not match the mutation', async () => {
    const ns = `esigbad-${Date.now().toString(36)}`
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

    const path = `/auth/namespaces/${ns}`
    const headers = await regulatedMutationHeaders(manager, {
      method: 'PATCH',
      path,
      body: { membersCanCreateRepos: false },
    })
    const mismatch = await app.request(path, {
      method: 'PATCH',
      headers: { ...headers, cookie: await cookie() },
      body: JSON.stringify({ membersCanCreateRepos: true }),
    })
    assert.equal(mismatch.status, 400)
    assert.equal(((await mismatch.json()) as { code?: string }).code, 'signature_invalid')
  })
})
