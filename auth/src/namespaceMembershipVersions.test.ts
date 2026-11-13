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
    await openLedger({ ...immudbConfig(), prefix: `esign-nsmem/${randomBytes(4).toString('hex')}/` }),
  ),
)

const manager = t.person('manager')
const member = t.person('member')
const other = t.person('other')
await preparePrincipal(manager)
await preparePrincipal(member)
await preparePrincipal(other)
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

type MembershipVersion = {
  validFrom: string
  validTo: string | null
  members: Array<{ kind: 'user' | 'group'; key: string; role: string }>
}

describe('namespace membership entity versions', () => {
  it('create opens owner v1; add / role change / remove append reconstructable history', async () => {
    const ns = `nsmem-${Date.now().toString(36)}`
    assert.equal(
      (await as(manager, 'POST', '/auth/namespaces', { name: ns, basePermission: 'none' })).status,
      200,
    )

    const h0 = await as(manager, 'GET', `/auth/namespaces/${ns}/members/history`)
    assert.equal(h0.status, 200)
    const v0 = (await h0.json()) as { versions: MembershipVersion[] }
    assert.equal(v0.versions.length, 1)
    assert.equal(v0.versions[0]!.validTo, null)
    assert.deepEqual(v0.versions[0]!.members, [
      { kind: 'user', key: userKey(manager), role: 'owner' },
    ])

    assert.equal(
      (
        await as(manager, 'PUT', `/auth/namespaces/${ns}/members`, {
          kind: 'user',
          sub: member.sub,
          iss: member.iss,
          role: 'member',
        })
      ).status,
      200,
    )
    assert.equal(
      (
        await as(manager, 'PUT', `/auth/namespaces/${ns}/members`, {
          kind: 'user',
          sub: member.sub,
          iss: member.iss,
          role: 'owner',
        })
      ).status,
      200,
    )
    assert.equal(
      (
        await as(manager, 'DELETE', `/auth/namespaces/${ns}/members`, {
          kind: 'user',
          sub: member.sub,
          iss: member.iss,
        })
      ).status,
      200,
    )

    const h1 = await as(manager, 'GET', `/auth/namespaces/${ns}/members/history`)
    assert.equal(h1.status, 200)
    const v1 = (await h1.json()) as { versions: MembershipVersion[] }
    assert.equal(v1.versions.length, 4)
    assert.ok(v1.versions[0]!.validTo)
    assert.deepEqual(v1.versions[0]!.members, [
      { kind: 'user', key: userKey(manager), role: 'owner' },
    ])
    assert.ok(v1.versions[1]!.validTo)
    assert.equal(v1.versions[1]!.members.length, 2)
    assert.ok(
      v1.versions[1]!.members.some((m) => m.key === userKey(member) && m.role === 'member'),
    )
    assert.ok(v1.versions[2]!.validTo)
    assert.ok(
      v1.versions[2]!.members.some((m) => m.key === userKey(member) && m.role === 'owner'),
    )
    assert.equal(v1.versions[3]!.validTo, null)
    assert.deepEqual(v1.versions[3]!.members, [
      { kind: 'user', key: userKey(manager), role: 'owner' },
    ])

    // Live membership matches current version; history is entity-sourced (not audit).
    const live = (await (await as(manager, 'GET', `/auth/namespaces/${ns}`)).json()) as {
      members: Array<{ kind: string; sub?: string; iss?: string; role: string }>
    }
    assert.equal(live.members.length, 1)
    assert.equal(live.members[0]!.role, 'owner')
    assert.equal(live.members[0]!.sub, manager.sub)
  })

  it('history GET requires namespace.members.manage; plain members are denied', async () => {
    const ns = `nsmem-rbac-${Date.now().toString(36)}`
    assert.equal(
      (await as(manager, 'POST', '/auth/namespaces', { name: ns, basePermission: 'none' })).status,
      200,
    )
    await setNamespaceMember(ns, other, 'member')

    assert.equal((await as(other, 'GET', `/auth/namespaces/${ns}/members/history`)).status, 403)
    assert.equal((await as(manager, 'GET', `/auth/namespaces/${ns}/members/history`)).status, 200)
  })
})
