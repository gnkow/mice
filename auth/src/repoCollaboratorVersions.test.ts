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
const { userKey } = await import('./authzTypes.js')

useSignatureStore(
  openSignatureStore(
    await openLedger({ ...immudbConfig(), prefix: `esign-repcollab/${randomBytes(4).toString('hex')}/` }),
  ),
)

const manager = t.person('manager')
const collab = t.person('collab')
const member = t.person('member')
await preparePrincipal(manager)
await preparePrincipal(collab)
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

type CollabVersion = {
  validFrom: string
  validTo: string | null
  collaborators: Array<{ kind: 'user' | 'group'; key: string; role: string }>
}

describe('repository collaborator entity versions', () => {
  it('add / role change / remove append reconstructable history', async () => {
    const ns = `repcollab-${Date.now().toString(36)}`
    const repo = 'study-a'
    assert.equal(
      (await as(manager, 'POST', '/auth/namespaces', { name: ns, basePermission: 'none' })).status,
      200,
    )

    const path = `/auth/namespaces/${ns}/repos/${repo}/collaborators`
    assert.equal(
      (
        await as(manager, 'PUT', path, {
          kind: 'user',
          sub: collab.sub,
          iss: collab.iss,
          role: 'write',
        })
      ).status,
      200,
    )

    const h0 = await as(manager, 'GET', `${path}/history`)
    assert.equal(h0.status, 200)
    const v0 = (await h0.json()) as { versions: CollabVersion[] }
    assert.equal(v0.versions.length, 1)
    assert.equal(v0.versions[0]!.validTo, null)
    assert.deepEqual(v0.versions[0]!.collaborators, [
      { kind: 'user', key: userKey(collab), role: 'write' },
    ])

    assert.equal(
      (
        await as(manager, 'PUT', path, {
          kind: 'user',
          sub: collab.sub,
          iss: collab.iss,
          role: 'maintain',
        })
      ).status,
      200,
    )
    assert.equal(
      (
        await as(manager, 'DELETE', path, {
          kind: 'user',
          sub: collab.sub,
          iss: collab.iss,
        })
      ).status,
      200,
    )

    const h1 = await as(manager, 'GET', `${path}/history`)
    assert.equal(h1.status, 200)
    const v1 = (await h1.json()) as { versions: CollabVersion[] }
    assert.equal(v1.versions.length, 3)
    assert.ok(v1.versions[0]!.validTo)
    assert.equal(v1.versions[0]!.collaborators[0]!.role, 'write')
    assert.ok(v1.versions[1]!.validTo)
    assert.equal(v1.versions[1]!.collaborators[0]!.role, 'maintain')
    assert.equal(v1.versions[2]!.validTo, null)
    assert.deepEqual(v1.versions[2]!.collaborators, [])
  })

  it('history GET requires collaborator manage; plain members are denied', async () => {
    const ns = `repcollab-rbac-${Date.now().toString(36)}`
    const repo = 'study-b'
    assert.equal(
      (await as(manager, 'POST', '/auth/namespaces', { name: ns, basePermission: 'none' })).status,
      200,
    )
    await setNamespaceMember(ns, member, 'member')
    const path = `/auth/namespaces/${ns}/repos/${repo}/collaborators`
    assert.equal(
      (
        await as(manager, 'PUT', path, {
          kind: 'user',
          sub: collab.sub,
          iss: collab.iss,
          role: 'read',
        })
      ).status,
      200,
    )
    assert.equal((await as(member, 'GET', `${path}/history`)).status, 403)
    assert.equal((await as(manager, 'GET', `${path}/history`)).status, 200)
  })
})
