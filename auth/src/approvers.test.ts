import './db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { isolatedAuth } from './testSupport.js'

const t = isolatedAuth({ AUTHZ_BOOTSTRAP_ADMINS: 'root@x.io' })
after(() => t.restore())

const { Hono } = await import('hono')
const { registerNamespaceRoutes } = await import('./namespaceRoutes.js')
const { preparePrincipal, decideIsApprover } = await import('./authz.js')
const { regulatedMutationHeaders, sealedSessionCookie } = await import('./testSupport.js')
const { setRepoCollaborator } = await import('./authzCollaboratorStore.js')

const root = { ...t.person('root'), email: 'root@x.io', emailVerified: true as const }
const owner = t.person('owner')
const bob = t.person('bob')
const carol = t.person('carol')
await preparePrincipal(root)
await t.grantRole(owner, 'manager')

const audits: Array<{ action: string; repo?: string }> = []
const app = new Hono()
registerNamespaceRoutes(app, { audit: async (_c, _u, _via, f) => void audits.push({ action: f.action, repo: f.repo }) })

const people = { root, owner, bob, carol } as const
const call = async (as: keyof typeof people, method: string, path: string, body?: unknown) => {
  const user = people[as]
  const mutation = body !== undefined || method !== 'GET'
  const headers = mutation
    ? {
        ...(await regulatedMutationHeaders(user, { method, path, body: body ?? {} })),
        cookie: await sealedSessionCookie({ ...user, sessionStart: Math.floor(Date.now() / 1000) }),
      }
    : {
        'content-type': 'application/json',
        cookie: await sealedSessionCookie({ ...user, sessionStart: Math.floor(Date.now() / 1000) }),
      }
  return app.request(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
}

await call('owner', 'POST', '/auth/namespaces', { name: 'acme', basePermission: 'read' })
const repoPath = '/auth/namespaces/acme/repos/data/approvers'
const nsPath = '/auth/namespaces/acme/approvers'

describe('approver role', () => {
  it('only the namespace Owner assigns or removes approvers, and each change is audited', async () => {
    assert.equal((await call('carol', 'PUT', repoPath, { sub: 'bob', iss: 'test' })).status, 403)
    assert.equal((await call('root', 'PUT', repoPath, { sub: 'bob', iss: 'test' })).status, 403)
    assert.equal((await call('owner', 'PUT', repoPath, { sub: 'bob' })).status, 400)

    assert.equal((await call('owner', 'PUT', repoPath, { sub: 'bob', iss: 'test' })).status, 200)
    assert.ok(audits.some((a) => a.action === 'approver.grant' && a.repo === 'data'))
    assert.equal((await call('carol', 'DELETE', repoPath, { sub: 'bob', iss: 'test' })).status, 403)
    assert.equal((await call('owner', 'DELETE', repoPath, { sub: 'bob', iss: 'test' })).status, 200)
    assert.ok(audits.some((a) => a.action === 'approver.revoke'))
  })

  it('the approver decision follows the grant at repository or namespace scope', async () => {
    assert.equal((await decideIsApprover(bob, 'acme', 'data')).allow, false)
    await call('owner', 'PUT', repoPath, { sub: 'bob', iss: 'test' })
    assert.equal((await decideIsApprover(bob, 'acme', 'data')).allow, true)
    assert.equal((await decideIsApprover(bob, 'acme', 'other')).allow, false)

    await call('owner', 'PUT', nsPath, { sub: 'carol', iss: 'test' })
    assert.equal((await decideIsApprover(carol, 'acme', 'other')).allow, true)

    await call('owner', 'DELETE', repoPath, { sub: 'bob', iss: 'test' })
    assert.equal((await decideIsApprover(bob, 'acme', 'data')).allow, false)
  })

  it('maintain, Owner and instance admin never imply approver', async () => {
    await setRepoCollaborator('acme', 'data', bob, 'maintain')
    assert.equal((await decideIsApprover(bob, 'acme', 'data')).allow, false)
    assert.equal((await decideIsApprover(owner, 'acme', 'data')).allow, false)
    assert.equal((await decideIsApprover(root, 'acme', 'data')).allow, false)
  })
})
