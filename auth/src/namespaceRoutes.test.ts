import './db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { isolatedAuth } from './testSupport.js'

const t = isolatedAuth({ AUTHZ_BOOTSTRAP_ADMINS: 'root@x.io' })
after(() => t.restore())

const { Hono } = await import('hono')
const { registerNamespaceRoutes } = await import('./namespaceRoutes.js')
const { preparePrincipal } = await import('./authz.js')
const { sealedSessionCookie } = await import('./testSupport.js')

const root = { ...t.person('root'), email: 'root@x.io', emailVerified: true as const }
const manager = t.person('manager')
const alice = t.person('alice')
await preparePrincipal(root)
await t.grantRole(manager, 'manager')

const audits: string[] = []
const app = new Hono()
registerNamespaceRoutes(app, { audit: async (_c, _u, _via, f) => void audits.push(f.action) })

const cookie = async (sub: string) => {
  const user = sub === 'root' ? root : sub === 'manager' ? manager : { ...t.person(sub), sessionStart: Math.floor(Date.now() / 1000) }
  return sealedSessionCookie({ ...user, sessionStart: Math.floor(Date.now() / 1000) })
}
const call = async (as: string | null, method: string, path: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-mice-reason': 'Routine test change', ...(as ? { cookie: await cookie(as) } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })

describe('namespace routes', () => {
  it('namespaces: anonymous 401, creation needs Manager; Admin reads and updates', async () => {
    assert.equal((await call(null, 'GET', '/auth/namespaces')).status, 401)
    assert.equal((await call('alice', 'POST', '/auth/namespaces', { name: 'acme', basePermission: 'read' })).status, 403)
    // Admin lacks namespace:create (S25); incomplete body still denied as permission, not validation.
    assert.equal((await call('root', 'POST', '/auth/namespaces', { name: 'acme' })).status, 403)
    assert.equal((await call('manager', 'POST', '/auth/namespaces', { name: 'acme' })).status, 400)

    const created = await call('manager', 'POST', '/auth/namespaces', { name: 'acme', basePermission: 'read' })
    assert.equal(created.status, 200)
    assert.ok(audits.includes('namespace.create'))

    const detail = (await (await call('root', 'GET', '/auth/namespaces/acme')).json()) as { name: string }
    assert.equal(detail.name, 'acme')
    assert.equal((await call('root', 'GET', '/auth/namespaces/nope')).status, 404)

    assert.equal((await call('alice', 'PATCH', '/auth/namespaces/acme', { basePermission: 'write' })).status, 403)
    assert.equal((await call('root', 'PATCH', '/auth/namespaces/acme', { basePermission: 'write' })).status, 200)
    assert.ok(audits.includes('namespace.settings.update'))
  })

  it('members: only managers change them, and bodies are validated', async () => {
    const path = '/auth/namespaces/acme/members'
    assert.equal((await call(null, 'PUT', path, { sub: 'bob', iss: 'test', role: 'member' })).status, 401)
    assert.equal((await call('alice', 'PUT', path, { sub: 'bob', iss: 'test', role: 'member' })).status, 403)
    assert.equal((await call('root', 'PUT', path, { sub: 'bob', iss: 'test' })).status, 400)
    assert.equal((await call('root', 'PUT', path, { role: 'member' })).status, 400)

    const set = await call('root', 'PUT', path, { sub: 'bob', iss: 'test', role: 'member' })
    assert.equal(set.status, 200)
    assert.ok(audits.includes('namespace.member.set'))
    const { members } = (await set.json()) as { members: Array<{ sub?: string }> }
    assert.ok(members.some((m) => m.sub === 'bob'))

    assert.equal((await call('alice', 'DELETE', path, { sub: 'bob', iss: 'test' })).status, 403)
    assert.equal((await call('root', 'DELETE', path, { sub: 'bob' })).status, 400)
    assert.equal((await call('root', 'DELETE', path, { sub: 'bob', iss: 'test' })).status, 200)
  })

  it('collaborators: managers list, set and remove', async () => {
    const path = '/auth/namespaces/acme/repos/data/collaborators'
    assert.equal((await call(null, 'GET', path)).status, 401)
    assert.equal((await call('alice', 'GET', path)).status, 403)
    assert.equal((await call('root', 'PUT', path, { sub: 'bob', iss: 'test' })).status, 400)

    assert.equal((await call('root', 'PUT', path, { sub: 'bob', iss: 'test', role: 'write' })).status, 200)
    const list = (await (await call('root', 'GET', path)).json()) as { collaborators: unknown[] }
    assert.equal(list.collaborators.length, 1)
    assert.equal((await call('root', 'DELETE', path, { sub: 'bob', iss: 'test' })).status, 200)
  })

  it('custom roles: catalog, create, update and delete for a namespace role', async () => {
    const base = '/auth/namespaces/acme/custom-roles'
    assert.equal((await call(null, 'GET', `${base}/permissions`)).status, 401)
    assert.equal((await call('alice', 'POST', `${base}/namespace`, { name: 'r', permissions: [] })).status, 403)
    assert.equal((await call('root', 'POST', `${base}/namespace`, { name: 'r' })).status, 400)

    const catalog = (await (await call('root', 'GET', `${base}/permissions`)).json()) as {
      namespaceCapabilities: string[]
    }
    const created = await call('root', 'POST', `${base}/namespace`, {
      name: 'reviewer',
      permissions: [catalog.namespaceCapabilities[0]],
    })
    assert.equal(created.status, 200)
    const { role } = (await created.json()) as { role: { id: string } }
    assert.ok(audits.includes('custom-role.namespace.create'))

    assert.equal((await call('root', 'PATCH', `${base}/namespace/${role.id}`, { name: 'reviewers' })).status, 200)
    assert.equal((await call('alice', 'DELETE', `${base}/namespace/${role.id}`)).status, 403)
    assert.equal((await call('root', 'DELETE', `${base}/namespace/${role.id}`)).status, 200)
    assert.equal((await call('root', 'POST', `${base}/repo`, { name: 'r' })).status, 400)
  })
})
