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
const { openSignatureStore, useSignatureStore } = await import('./authentication/signing/signatureStore.js')
const { immudbConfig, openLedger } = await import('./auditLedger.js')
const {
  createCustomNamespaceRole,
  createCustomRepoRole,
  deleteCustomNamespaceRole,
  listCustomRoleVersions,
  updateCustomNamespaceRole,
  updateCustomRepoRole,
} = await import('./customRoles.js')
const { createNamespace } = await import('./authzRepository.js')
const { userKey } = await import('./authzTypes.js')

useSignatureStore(
  openSignatureStore(
    await openLedger({ ...immudbConfig(), prefix: `esign-rolever/${randomBytes(4).toString('hex')}/` }),
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
  const isNsCreate = method === 'POST' && /^\/auth\/namespaces\/?$/.test(path)
  const needsSig = method !== 'GET' && method !== 'HEAD' && !isNsCreate
  const headers = needsSig
    ? await regulatedMutationHeaders(user, { method, path, body: body ?? {} })
    : { 'content-type': 'application/json' }
  return app.request(path, {
    method,
    headers: { ...headers, cookie: await cookie(user) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

type RoleVersion = {
  validFrom: string
  validTo: string | null
  kind: 'namespace' | 'repo'
  roleId: string
  definition: Record<string, unknown>
}

describe('custom role entity versions (module)', () => {
  it('create / update / delete append reconstructable definition history', async () => {
    const ns = `rolever-mod-${Date.now().toString(36)}`
    const created = await createNamespace(userKey(manager), ns, 'none', true, '')
    assert.equal(created.ok, true)

    const nsRole = await createCustomNamespaceRole(ns, {
      name: 'reviewer',
      permissions: ['view_audit'],
    })
    assert.equal(nsRole.ok, true)
    if (!nsRole.ok) return
    const roleId = nsRole.role.id

    const v0 = await listCustomRoleVersions(ns)
    assert.ok(v0)
    assert.equal(v0!.length, 1)
    assert.equal(v0![0]!.validTo, null)
    assert.equal(v0![0]!.kind, 'namespace')
    assert.equal(v0![0]!.roleId, roleId)
    assert.deepEqual(v0![0]!.definition, {
      id: roleId,
      name: 'reviewer',
      permissions: ['view_audit'],
    })

    const updated = await updateCustomNamespaceRole(ns, roleId, {
      name: 'reviewers',
      permissions: ['view_audit', 'manage_settings'],
    })
    assert.equal(updated.ok, true)

    const v1 = await listCustomRoleVersions(ns)
    assert.ok(v1)
    assert.equal(v1!.length, 2)
    assert.ok(v1![0]!.validTo)
    assert.deepEqual(v1![0]!.definition, {
      id: roleId,
      name: 'reviewer',
      permissions: ['view_audit'],
    })
    assert.equal(v1![1]!.validTo, null)
    assert.deepEqual(v1![1]!.definition, {
      id: roleId,
      name: 'reviewers',
      permissions: ['view_audit', 'manage_settings'],
    })

    assert.equal((await deleteCustomNamespaceRole(ns, roleId, false)).ok, true)
    const v2 = await listCustomRoleVersions(ns)
    assert.ok(v2)
    assert.equal(v2!.length, 2)
    assert.ok(v2![1]!.validTo)
    assert.deepEqual(v2![1]!.definition, {
      id: roleId,
      name: 'reviewers',
      permissions: ['view_audit', 'manage_settings'],
    })
  })

  it('repo role create / update append definition history', async () => {
    const ns = `rolever-repo-${Date.now().toString(36)}`
    assert.equal((await createNamespace(userKey(manager), ns, 'none', true, '')).ok, true)

    const created = await createCustomRepoRole(ns, {
      name: 'analyst',
      base: 'read',
      permissions: ['job_read'],
    })
    assert.equal(created.ok, true)
    if (!created.ok) return

    const updated = await updateCustomRepoRole(ns, created.role.id, {
      base: 'write',
      permissions: ['job_submit'],
    })
    assert.equal(updated.ok, true)

    const versions = await listCustomRoleVersions(ns)
    assert.ok(versions)
    assert.equal(versions!.length, 2)
    assert.equal(versions![0]!.kind, 'repo')
    assert.equal(versions![0]!.definition.base, 'read')
    assert.equal(versions![1]!.definition.base, 'write')
    assert.equal(versions![1]!.validTo, null)
  })
})

describe('custom role entity versions (HTTP)', () => {
  it('create / update / delete reconstruct via GET history without reading Audit', async () => {
    const ns = `rolever-http-${Date.now().toString(36)}`
    assert.equal(
      (await as(manager, 'POST', '/auth/namespaces', { name: ns, basePermission: 'none' })).status,
      200,
    )

    const createBody = { name: 'steward', permissions: ['manage_members'] }
    const created = await as(manager, 'POST', `/auth/namespaces/${ns}/custom-roles/namespace`, createBody)
    assert.equal(created.status, 200)
    const { role } = (await created.json()) as { role: { id: string; name: string } }

    const h0 = await as(manager, 'GET', `/auth/namespaces/${ns}/custom-roles/history`)
    assert.equal(h0.status, 200)
    const v0 = (await h0.json()) as { versions: RoleVersion[] }
    assert.equal(v0.versions.length, 1)
    assert.equal(v0.versions[0]!.validTo, null)
    assert.equal(v0.versions[0]!.roleId, role.id)
    assert.equal(v0.versions[0]!.definition.name, 'steward')

    assert.equal(
      (
        await as(manager, 'PATCH', `/auth/namespaces/${ns}/custom-roles/namespace/${role.id}`, {
          permissions: ['manage_members', 'view_audit'],
        })
      ).status,
      200,
    )
    assert.equal(
      (await as(manager, 'DELETE', `/auth/namespaces/${ns}/custom-roles/namespace/${role.id}`)).status,
      200,
    )

    const h1 = await as(manager, 'GET', `/auth/namespaces/${ns}/custom-roles/history`)
    assert.equal(h1.status, 200)
    const v1 = (await h1.json()) as { versions: RoleVersion[] }
    assert.equal(v1.versions.length, 2)
    assert.ok(v1.versions[0]!.validTo)
    assert.deepEqual(v1.versions[0]!.definition.permissions, ['manage_members'])
    assert.ok(v1.versions[1]!.validTo)
    assert.deepEqual(v1.versions[1]!.definition.permissions, ['manage_members', 'view_audit'])
  })

  it('history requires namespace.roles.manage', async () => {
    const ns = `rolever-authz-${Date.now().toString(36)}`
    assert.equal(
      (await as(manager, 'POST', '/auth/namespaces', { name: ns, basePermission: 'none' })).status,
      200,
    )
    assert.equal((await as(member, 'GET', `/auth/namespaces/${ns}/custom-roles/history`)).status, 403)
    assert.equal((await as(manager, 'GET', `/auth/namespaces/${ns}/custom-roles/history`)).status, 200)
  })
})
