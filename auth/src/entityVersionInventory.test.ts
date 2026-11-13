import './db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { randomBytes } from 'node:crypto'
import { isolatedAuth, regulatedMutationHeaders } from './testSupport.js'
import {
  entityVersionInventory,
  exemptEntities,
  versionedEntities,
} from './entityVersionInventory.js'

const t = isolatedAuth({ AUTHZ_BOOTSTRAP_ADMINS: 'root@x.io' })
after(() => t.restore())

const { Hono } = await import('hono')
const { registerNamespaceRoutes } = await import('./namespaceRoutes.js')
const { preparePrincipal } = await import('./authz.js')
const { sealedSessionCookie } = await import('./testSupport.js')
const { openSignatureStore, useSignatureStore } = await import('./authentication/signing/signatureStore.js')
const { immudbConfig, openLedger } = await import('./auditLedger.js')

useSignatureStore(
  openSignatureStore(
    await openLedger({ ...immudbConfig(), prefix: `esign-evi/${randomBytes(4).toString('hex')}/` }),
  ),
)

const manager = t.person('manager')
await preparePrincipal(manager)
await t.grantRole(manager, 'manager')

const app = new Hono()
registerNamespaceRoutes(app, { audit: async () => {} })

const cookie = async () => sealedSessionCookie({ ...manager, sessionStart: Math.floor(Date.now() / 1000) })

async function as(method: string, path: string, body?: unknown) {
  const isNsCreate = method === 'POST' && /^\/auth\/namespaces\/?$/.test(path)
  const needsSig = method !== 'GET' && method !== 'HEAD' && !isNsCreate
  const headers = needsSig
    ? await regulatedMutationHeaders(manager, { method, path, body: body ?? {} })
    : { 'content-type': 'application/json' }
  return app.request(path, {
    method,
    headers: { ...headers, cookie: await cookie() },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

describe('entity version inventory (unit)', () => {
  it('lists mutable entities; every exemption has a rationale; tickets 21–24 are versioned', () => {
    const rows = entityVersionInventory()
    assert.ok(rows.length >= 15)
    for (const row of exemptEntities()) {
      assert.ok(row.rationale && row.rationale.length > 10, row.id)
    }
    const versionedIds = new Set(versionedEntities().map((e) => e.id))
    for (const id of ['ns.settings', 'ns.membership', 'repo.collaborators', 'custom.roles']) {
      assert.ok(versionedIds.has(id), id)
    }
    for (const row of versionedEntities()) {
      assert.ok(row.store, row.id)
      assert.ok(row.historySeam, row.id)
    }
  })
})

describe('entity version inventory (HTTP — history is entity-sourced)', () => {
  it('settings / members / collaborators / custom-roles history GETs return versions without Audit', async () => {
    const ns = `evi-${Date.now().toString(36)}`
    assert.equal((await as('POST', '/auth/namespaces', { name: ns, basePermission: 'none' })).status, 200)

    const settings = await as('GET', `/auth/namespaces/${ns}/settings/history`)
    assert.equal(settings.status, 200)
    const sBody = (await settings.json()) as { versions: unknown[] }
    assert.ok(Array.isArray(sBody.versions))
    assert.ok(sBody.versions.length >= 1)

    const members = await as('GET', `/auth/namespaces/${ns}/members/history`)
    assert.equal(members.status, 200)
    const mBody = (await members.json()) as { versions: unknown[] }
    assert.ok(mBody.versions.length >= 1)

    const repo = 'study'
    assert.equal(
      (
        await as('PUT', `/auth/namespaces/${ns}/repos/${repo}/collaborators`, {
          kind: 'user',
          sub: manager.sub,
          iss: manager.iss,
          role: 'write',
        })
      ).status,
      200,
    )
    const collab = await as('GET', `/auth/namespaces/${ns}/repos/${repo}/collaborators/history`)
    assert.equal(collab.status, 200)
    assert.ok(((await collab.json()) as { versions: unknown[] }).versions.length >= 1)

    const roleRes = await as('POST', `/auth/namespaces/${ns}/custom-roles/namespace`, {
      name: 'evi-role',
      permissions: ['view_audit'],
    })
    assert.equal(roleRes.status, 200)
    const roles = await as('GET', `/auth/namespaces/${ns}/custom-roles/history`)
    assert.equal(roles.status, 200)
    assert.ok(((await roles.json()) as { versions: unknown[] }).versions.length >= 1)
  })
})
