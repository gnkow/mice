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

  it('Owner can grant and revoke a group approver seat', async () => {
    const groupId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    const groupKey = `test|${groupId}`
    const put = await call('owner', 'PUT', repoPath, {
      kind: 'group',
      group: groupKey,
      name: 'QA',
    })
    assert.equal(put.status, 200)
    const listed = (await put.json()) as {
      approvers: Array<{ kind: string; group?: string; name?: string }>
    }
    assert.ok(
      listed.approvers.some(
        (a) => a.kind === 'group' && a.group === groupKey && a.name === 'QA',
      ),
    )
    assert.equal(
      (await decideIsApprover({ ...bob, groups: [groupKey] }, 'acme', 'data')).allow,
      true,
    )
    assert.equal(
      (await call('owner', 'DELETE', repoPath, { kind: 'group', group: groupKey })).status,
      200,
    )
    assert.equal(
      (await decideIsApprover({ ...bob, groups: [groupKey] }, 'acme', 'data')).allow,
      false,
    )
  })
})

describe('approver seat entity versions (#124)', () => {
  const historyOf = async (as: keyof typeof people, path: string) => {
    const res = await call(as, 'GET', `${path}/history`)
    return {
      status: res.status,
      body: (await res.json()) as {
        versions?: Array<{
          validFrom: string
          validTo: string | null
          approvers: Array<{ kind?: string; sub?: string; iss?: string; group?: string }>
        }>
      },
    }
  }
  const subs = (v: {
    approvers: Array<{ kind?: string; sub?: string; iss?: string; group?: string }>
  }) =>
    v.approvers
      .map((a) => (a.kind === 'group' ? a.group ?? '' : a.sub ?? ''))
      .sort()

  it('appends one version per effective namespace change and keeps closed intervals', async () => {
    await call('owner', 'POST', '/auth/namespaces', { name: 'versions-ns', basePermission: 'read' })
    const path = '/auth/namespaces/versions-ns/approvers'
    assert.deepEqual((await historyOf('owner', path)).body.versions, [])

    assert.equal((await call('owner', 'PUT', path, { sub: 'bob', iss: 'test' })).status, 200)
    assert.equal((await call('owner', 'PUT', path, { sub: 'bob', iss: 'test' })).status, 200, 'idempotent grant')
    assert.equal((await call('owner', 'PUT', path, { sub: 'carol', iss: 'test' })).status, 200)
    assert.equal((await call('owner', 'DELETE', path, { sub: 'bob', iss: 'test' })).status, 200)
    assert.equal((await call('owner', 'DELETE', path, { sub: 'bob', iss: 'test' })).status, 200, 'idempotent revoke')

    const { status, body } = await historyOf('owner', path)
    assert.equal(status, 200)
    const versions = body.versions!
    assert.deepEqual(versions.map(subs), [['bob'], ['bob', 'carol'], ['carol']])
    assert.equal(versions.at(-1)!.validTo, null)
    for (const closed of versions.slice(0, -1)) assert.ok(closed.validTo)
    assert.equal(versions[0]!.validTo, versions[1]!.validFrom)
  })

  it('records repository approver history separately from the namespace', async () => {
    const path = '/auth/namespaces/versions-ns/repos/ledger/approvers'
    assert.deepEqual((await historyOf('owner', path)).body.versions, [])
    await call('owner', 'PUT', path, { sub: 'bob', iss: 'test' })
    await call('owner', 'DELETE', path, { sub: 'bob', iss: 'test' })
    const versions = (await historyOf('owner', path)).body.versions!
    assert.deepEqual(versions.map(subs), [['bob'], []])
    const ns = (await historyOf('owner', '/auth/namespaces/versions-ns/approvers')).body.versions!
    assert.equal(ns.length, 3, 'namespace history untouched by repo seats')
  })

  it('only the namespace Owner reads history; unknown namespaces are denied', async () => {
    assert.equal((await historyOf('carol', '/auth/namespaces/versions-ns/approvers')).status, 403)
    assert.equal((await historyOf('root', '/auth/namespaces/versions-ns/approvers')).status, 403)
    assert.equal((await historyOf('owner', '/auth/namespaces/nope-ns/approvers')).status, 403)
  })
})
