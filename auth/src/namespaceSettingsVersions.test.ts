import './db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { isolatedAuth, regulatedMutationHeaders } from './testSupport.js'
import { randomBytes } from 'node:crypto'

const t = isolatedAuth({ AUTHZ_BOOTSTRAP_ADMINS: 'root@x.io' })
after(() => t.restore())

const { Hono } = await import('hono')
const { registerNamespaceRoutes } = await import('./namespaceRoutes.js')
const { preparePrincipal } = await import('./authz.js')
const { sealedSessionCookie } = await import('./testSupport.js')
const { setNamespaceMember } = await import('./authzMembershipStore.js')
const { openSignatureStore, useSignatureStore } = await import('./authentication/signing/signatureStore.js')
const { immudbConfig, openLedger } = await import('./auditLedger.js')

useSignatureStore(
  openSignatureStore(
    await openLedger({ ...immudbConfig(), prefix: `esign-nsver/${randomBytes(4).toString('hex')}/` }),
  ),
)

const manager = t.person('manager')
const member = t.person('member')
await preparePrincipal(manager)
await preparePrincipal(member)
await t.grantRole(manager, 'manager')

const app = new Hono()
registerNamespaceRoutes(app, { audit: async () => {} })

const cookie = async (user: typeof manager) =>
  sealedSessionCookie({ ...user, sessionStart: Math.floor(Date.now() / 1000) })

async function as(user: typeof manager, method: string, path: string, body?: unknown) {
  const needsSig = method !== 'GET' && method !== 'HEAD' && method !== 'POST'
  const headers = needsSig
    ? await regulatedMutationHeaders(user, { method, path, body: body ?? {} })
    : { 'content-type': 'application/json' }
  return app.request(path, {
    method,
    headers: { ...headers, cookie: await cookie(user) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

describe('namespace settings entity versions', () => {
  it('create opens v1; N patches yield N+1 reconstructable states including rename', async () => {
    const ns = `nsver-${Date.now().toString(36)}`
    const created = await as(manager, 'POST', '/auth/namespaces', {
      name: ns,
      description: 'Initial study namespace',
      basePermission: 'read',
    })
    assert.equal(created.status, 200)
    const createdBody = (await created.json()) as {
      namespace: { id: string; name: string; description: string }
    }
    const id = createdBody.namespace.id

    const h0 = await as(manager, 'GET', `/auth/namespaces/${ns}/settings/history`)
    assert.equal(h0.status, 200)
    const v0 = (await h0.json()) as {
      versions: Array<{
        name: string
        description: string
        basePermission: string
        validTo: string | null
      }>
    }
    assert.equal(v0.versions.length, 1)
    assert.equal(v0.versions[0]!.name, ns)
    assert.equal(v0.versions[0]!.description, 'Initial study namespace')
    assert.equal(v0.versions[0]!.basePermission, 'read')
    assert.equal(v0.versions[0]!.validTo, null)

    assert.equal(
      (
        await as(manager, 'PATCH', `/auth/namespaces/${ns}`, {
          description: 'Updated description',
        })
      ).status,
      200,
    )
    assert.equal(
      (
        await as(manager, 'PATCH', `/auth/namespaces/${ns}`, {
          basePermission: 'write',
        })
      ).status,
      200,
    )
    const renamedTo = `${ns}-renamed`
    const rename = await as(manager, 'PATCH', `/auth/namespaces/${ns}`, { name: renamedTo })
    assert.equal(rename.status, 200)
    const renameBody = (await rename.json()) as { id: string; name: string }
    assert.equal(renameBody.id, id)
    assert.equal(renameBody.name, renamedTo)

    const h1 = await as(manager, 'GET', `/auth/namespaces/${renamedTo}/settings/history`)
    assert.equal(h1.status, 200)
    const v1 = (await h1.json()) as {
      versions: Array<{
        name: string
        description: string
        basePermission: string
        validTo: string | null
      }>
    }
    assert.equal(v1.versions.length, 4)
    assert.equal(v1.versions[0]!.name, ns)
    assert.equal(v1.versions[0]!.description, 'Initial study namespace')
    assert.ok(v1.versions[0]!.validTo)
    assert.equal(v1.versions[1]!.description, 'Updated description')
    assert.equal(v1.versions[1]!.basePermission, 'read')
    assert.ok(v1.versions[1]!.validTo)
    assert.equal(v1.versions[2]!.basePermission, 'write')
    assert.ok(v1.versions[2]!.validTo)
    assert.equal(v1.versions[3]!.name, renamedTo)
    assert.equal(v1.versions[3]!.validTo, null)

    const live = (await (await as(manager, 'GET', `/auth/namespaces/${renamedTo}`)).json()) as {
      id: string
      name: string
      description: string
      basePermission: string
    }
    assert.equal(live.id, id)
    assert.equal(live.name, renamedTo)
    assert.equal(live.description, 'Updated description')
    assert.equal(live.basePermission, 'write')
    assert.equal(live.name, v1.versions[3]!.name)
    assert.equal(live.description, v1.versions[3]!.description)
    assert.equal(live.basePermission, v1.versions[3]!.basePermission)
  })

  it('history GET requires namespace.settings; members without manage_settings are denied', async () => {
    const ns = `nsver-rbac-${Date.now().toString(36)}`
    assert.equal(
      (await as(manager, 'POST', '/auth/namespaces', { name: ns, basePermission: 'none' })).status,
      200,
    )
    await setNamespaceMember(ns, member, 'member')

    assert.equal((await as(member, 'GET', `/auth/namespaces/${ns}/settings/history`)).status, 403)
    assert.equal((await as(manager, 'GET', `/auth/namespaces/${ns}/settings/history`)).status, 200)
  })
})

describe('namespace settings entity versions (module seam)', () => {
  it('createNamespace opens v1; updateNamespaceSettings appends reconstructable states', async () => {
    const { createNamespace, updateNamespaceSettings, listNamespaceSettingsVersions } =
      await import('./authzRepository.js')
    const { userKey } = await import('./authzTypes.js')
    const ns = `nsver-mod-${Date.now().toString(36)}`
    assert.equal((await createNamespace(userKey(manager), ns, 'read', true, 'v1')).ok, true)

    const v0 = await listNamespaceSettingsVersions(ns)
    assert.ok(v0)
    assert.equal(v0!.length, 1)
    assert.equal(v0![0]!.description, 'v1')
    assert.equal(v0![0]!.basePermission, 'read')
    assert.equal(v0![0]!.validTo, null)

    assert.equal((await updateNamespaceSettings(ns, { description: 'v2', basePermission: 'write' })).ok, true)
    const v1 = await listNamespaceSettingsVersions(ns)
    assert.ok(v1)
    assert.equal(v1!.length, 2)
    assert.ok(v1![0]!.validTo)
    assert.equal(v1![0]!.description, 'v1')
    assert.equal(v1![1]!.description, 'v2')
    assert.equal(v1![1]!.basePermission, 'write')
    assert.equal(v1![1]!.validTo, null)
  })
})
