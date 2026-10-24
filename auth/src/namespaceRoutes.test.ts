import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-nsr-'))
process.env.SESSION_SECRET = 'test-secret-nsr'
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'root@x.io'

const { Hono } = await import('hono')
const { registerNamespaceRoutes } = await import('./namespaceRoutes.js')
const { sealSession } = await import('./session.js')
const { maybeBootstrapInstanceAdmin } = await import('./authzInstanceStore.js')
const { env } = await import('./env.js')

const mk = (sub: string) => ({ sub, iss: 'idp', email: `${sub}@x.io`, name: sub })
maybeBootstrapInstanceAdmin({ ...mk('root'), emailVerified: true })

const audits: string[] = []
const app = new Hono()
registerNamespaceRoutes(app, { audit: (_c, _u, _via, f) => void audits.push(f.action) })

const cookie = async (sub: string) =>
  `${env.cookieName}=${await sealSession({ ...mk(sub), sessionStart: Math.floor(Date.now() / 1000) })}`
const call = async (as: string | null, method: string, path: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: { 'content-type': 'application/json', ...(as ? { cookie: await cookie(as) } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })

describe('namespace routes', () => {
  it('namespaces: anonymous 401, creation needs permission, admin creates, reads and updates', async () => {
    assert.equal((await call(null, 'GET', '/auth/namespaces')).status, 401)
    assert.equal((await call('alice', 'POST', '/auth/namespaces', { name: 'acme', basePermission: 'read' })).status, 403)
    assert.equal((await call('root', 'POST', '/auth/namespaces', { name: 'acme' })).status, 400)

    const created = await call('root', 'POST', '/auth/namespaces', { name: 'acme', basePermission: 'read' })
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
    assert.equal((await call(null, 'PUT', path, { sub: 'bob', iss: 'idp', role: 'member' })).status, 401)
    assert.equal((await call('alice', 'PUT', path, { sub: 'bob', iss: 'idp', role: 'member' })).status, 403)
    assert.equal((await call('root', 'PUT', path, { sub: 'bob', iss: 'idp' })).status, 400)
    assert.equal((await call('root', 'PUT', path, { role: 'member' })).status, 400)

    const set = await call('root', 'PUT', path, { sub: 'bob', iss: 'idp', role: 'member' })
    assert.equal(set.status, 200)
    assert.ok(audits.includes('namespace.member.set'))
    const { members } = (await set.json()) as { members: Array<{ sub?: string }> }
    assert.ok(members.some((m) => m.sub === 'bob'))

    assert.equal((await call('alice', 'DELETE', path, { sub: 'bob', iss: 'idp' })).status, 403)
    assert.equal((await call('root', 'DELETE', path, { sub: 'bob' })).status, 400)
    assert.equal((await call('root', 'DELETE', path, { sub: 'bob', iss: 'idp' })).status, 200)
  })

  it('collaborators: managers list, set and remove', async () => {
    const path = '/auth/namespaces/acme/repos/data/collaborators'
    assert.equal((await call(null, 'GET', path)).status, 401)
    assert.equal((await call('alice', 'GET', path)).status, 403)
    assert.equal((await call('root', 'PUT', path, { sub: 'bob', iss: 'idp' })).status, 400)

    assert.equal((await call('root', 'PUT', path, { sub: 'bob', iss: 'idp', role: 'write' })).status, 200)
    const list = (await (await call('root', 'GET', path)).json()) as { collaborators: unknown[] }
    assert.equal(list.collaborators.length, 1)
    assert.equal((await call('root', 'DELETE', path, { sub: 'bob', iss: 'idp' })).status, 200)
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
