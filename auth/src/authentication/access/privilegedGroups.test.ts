import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

process.env.AUTHZ_BOOTSTRAP_ADMINS = 'admin@mice.local'
process.env.AUTHZ_REQUIRE_TRAINING = 'false'
process.env.SESSION_SECRET = 'test-secret'
process.env.OXEN_UPSTREAM = 'http://127.0.0.1:3001'
process.env.DIRECTORY_PROVIDER = 'keycloak'
process.env.KEYCLOAK_ADMIN_URL = 'http://kc.test'
process.env.KEYCLOAK_REALM = 'mice'
process.env.OIDC_CLIENT_ID = 'mice-auth'
process.env.OIDC_CLIENT_SECRET = 'secret'
process.env.OIDC_ISSUER_PUBLIC = 'http://kc.test/realms/mice'

const GROUP = '11111111-1111-4111-8111-111111111111'
const ADDED = '33333333-3333-4333-8333-333333333333'

const {
  authorizeApiRequest,
  authorizeRepoAction,
  decideManageRepoCollaborators,
  decideNamespaceAction,
} = await import('../../authz.js')
const { createNamespaceAuthz } = await import('../../authzNamespaceStore.js')
const { removeRepoGroupCollaborator, setRepoGroupCollaborator } = await import('../../authzCollaboratorStore.js')
const { removeNamespaceGroupMember, setNamespaceGroupMember } = await import('../../authzMembershipStore.js')
const { setDirectoryFetchForTests } = await import('../directory/directory.js')
const { ensurePrincipal } = await import('../session/session.js')
const { assignRole } = await import('../../rbacStore.js')

/** Pending gate (S23): authorize* requires a formal role even when ACL would allow. */
async function withUserRole<T extends { sub: string; iss: string; email?: string; name?: string }>(
  user: T,
): Promise<T> {
  await ensurePrincipal(user)
  assert.equal(
    (await assignRole({ actor: null, target: user, role: 'user', reason: 'test', bootstrap: true })).ok,
    true,
  )
  return user
}

setDirectoryFetchForTests(async (url) => {
  const urlStr = String(url)
  if (urlStr.includes('/protocol/openid-connect/token')) {
    return new Response(JSON.stringify({ access_token: 'tok', expires_in: 60 }), { status: 200 })
  }
  if (urlStr.includes('/users/qa-added/groups')) {
    return new Response(JSON.stringify([{ id: ADDED, name: 'Newcomers' }]), { status: 200 })
  }
  if (urlStr.includes('/users/qa-grant/groups')) {
    return new Response(JSON.stringify([{ id: GROUP, name: 'Quality' }]), { status: 200 })
  }
  if (urlStr.includes('/users/qa-down/groups') || urlStr.includes('/users/qa-sign/groups')) {
    return new Response('directory down', { status: 503 })
  }
  if (urlStr.includes('/users/qa-sign')) {
    return new Response(JSON.stringify({ enabled: true, firstName: 'QA', lastName: 'Signer' }), { status: 200 })
  }
  if (urlStr.includes('/groups')) {
    return new Response(JSON.stringify([]), { status: 200 })
  }
  return new Response('{}', { status: 404 })
})

const admin = {
  sub: 'admin',
  iss: 'http://kc.test/realms/mice',
  email: 'admin@mice.local',
  emailVerified: true,
  name: 'Admin',
}

describe('privileged group re-check', () => {
  it('a group removed in the directory cannot merge', async () => {
    const ns = 'priv-merge'
    assert.equal((await createNamespaceAuthz(admin, ns, 'none', true)).ok, true)
    assert.equal((await setRepoGroupCollaborator(ns, 'study', GROUP, 'maintain')).ok, true)
    const holder = await withUserRole({
      sub: 'qa',
      iss: 'http://kc.test/realms/mice',
      email: 'qa@example.com',
      emailVerified: true,
      name: 'QA',
      groups: [GROUP],
    })
    const merge = await authorizeApiRequest({
      user: holder,
      via: 'session',
      method: 'POST',
      pathname: `/api/repos/${ns}/study/merge`,
    })
    assert.equal(merge.allow, false)
    assert.equal(merge.status, 403)
  })

  it('a group removed in the directory cannot write a repository file', async () => {
    const ns = 'priv-write'
    assert.equal((await createNamespaceAuthz(admin, ns, 'none', true)).ok, true)
    assert.equal((await setRepoGroupCollaborator(ns, 'study', GROUP, 'write')).ok, true)
    const holder = await withUserRole({
      sub: 'qa',
      iss: 'http://kc.test/realms/mice',
      email: 'qa@example.com',
      emailVerified: true,
      name: 'QA',
      groups: [GROUP],
    })
    const write = await authorizeApiRequest({
      user: holder,
      via: 'session',
      method: 'PUT',
      pathname: `/api/repos/${ns}/study/file/main/analysis.csv`,
    })
    assert.equal(write.allow, false)
    assert.equal(write.status, 403)
  })

  it('revokes group-derived writes immediately when namespace or repository grants change', async () => {
    const ns = 'priv-grant-change'
    assert.equal((await createNamespaceAuthz(admin, ns, 'none', true)).ok, true)
    assert.equal((await setNamespaceGroupMember(ns, GROUP, 'member')).ok, true)
    assert.equal((await setRepoGroupCollaborator(ns, 'study', GROUP, 'write')).ok, true)
    const holder = await withUserRole({
      sub: 'qa-grant',
      iss: 'http://kc.test/realms/mice',
      email: 'qa@example.com',
      emailVerified: true,
      name: 'QA',
      groups: [GROUP],
    })
    assert.equal((await authorizeApiRequest({
      user: holder,
      via: 'session',
      method: 'PUT',
      pathname: `/api/repos/${ns}/study/file/main/analysis.csv`,
    })).allow, true)

    await removeRepoGroupCollaborator(ns, 'study', GROUP)
    assert.equal((await authorizeApiRequest({
      user: holder,
      via: 'session',
      method: 'PUT',
      pathname: `/api/repos/${ns}/study/file/main/analysis.csv`,
    })).allow, false)

    await removeNamespaceGroupMember(ns, GROUP)
    const created = await authorizeApiRequest({
      user: holder,
      via: 'session',
      method: 'POST',
      pathname: '/api/repos',
      createNamespace: ns,
      createRepo: 'new-study',
    })
    assert.equal(created.allow, false)
  })

  it('an ordinary read keeps the group stored on the Session', async () => {
    const ns = 'priv-read'
    assert.equal((await createNamespaceAuthz(admin, ns, 'none', true)).ok, true)
    assert.equal((await setRepoGroupCollaborator(ns, 'study', GROUP, 'maintain')).ok, true)
    const holder = await withUserRole({
      sub: 'qa',
      iss: 'http://kc.test/realms/mice',
      email: 'qa@example.com',
      emailVerified: true,
      name: 'QA',
      groups: [GROUP],
    })
    const read = await authorizeApiRequest({
      user: holder,
      via: 'session',
      method: 'GET',
      pathname: `/api/repos/${ns}/study`,
    })
    assert.equal(read.allow, true)
  })

  it('a directory failure on merge returns 503', async () => {
    const ns = 'priv-down'
    assert.equal((await createNamespaceAuthz(admin, ns, 'none', true)).ok, true)
    assert.equal((await setRepoGroupCollaborator(ns, 'study', GROUP, 'maintain')).ok, true)
    const holder = await withUserRole({
      sub: 'qa-down',
      iss: 'http://kc.test/realms/mice',
      email: 'qa@example.com',
      emailVerified: true,
      name: 'QA',
      groups: [GROUP],
    })
    const merge = await authorizeApiRequest({
      user: holder,
      via: 'session',
      method: 'POST',
      pathname: `/api/repos/${ns}/study/merge`,
    })
    assert.equal(merge.allow, false)
    assert.equal(merge.status, 503)
  })

  it('a group removed in the directory cannot delete the repository', async () => {
    const ns = 'priv-admin'
    assert.equal((await createNamespaceAuthz(admin, ns, 'none', true)).ok, true)
    assert.equal((await setRepoGroupCollaborator(ns, 'study', GROUP, 'admin')).ok, true)
    const holder = await withUserRole({
      sub: 'qa-admin',
      iss: 'http://kc.test/realms/mice',
      email: 'qa@example.com',
      emailVerified: true,
      name: 'QA',
      groups: [GROUP],
    })
    const deletion = await authorizeApiRequest({
      user: holder,
      via: 'session',
      method: 'DELETE',
      pathname: `/api/repos/${ns}/study`,
    })
    assert.equal(deletion.allow, false)
    assert.equal(deletion.status, 403)
  })

  it('a group removed in the directory cannot manage repository collaborators', async () => {
    const ns = 'priv-collab'
    assert.equal((await createNamespaceAuthz(admin, ns, 'none', true)).ok, true)
    assert.equal((await setRepoGroupCollaborator(ns, 'study', GROUP, 'admin')).ok, true)
    const holder = await withUserRole({
      sub: 'qa-collab',
      iss: 'http://kc.test/realms/mice',
      email: 'qa@example.com',
      emailVerified: true,
      name: 'QA',
      groups: [GROUP],
    })
    const decision = await decideManageRepoCollaborators(holder, ns, 'study')
    assert.equal(decision.allow, false)
    assert.equal(decision.status, 403)
  })

  it('a group removed in the directory cannot submit a job', async () => {
    const ns = 'priv-job'
    assert.equal((await createNamespaceAuthz(admin, ns, 'none', true)).ok, true)
    assert.equal((await setRepoGroupCollaborator(ns, 'study', GROUP, 'write')).ok, true)
    const holder = await withUserRole({
      sub: 'qa',
      iss: 'http://kc.test/realms/mice',
      email: 'qa@example.com',
      emailVerified: true,
      name: 'QA',
      groups: [GROUP],
    })
    const decision = await authorizeRepoAction(holder, ns, 'study', 'job.submit')
    assert.equal(decision.allow, false)
    assert.equal(decision.status, 403)
  })

  it('signing returns 503 when the directory cannot list groups', async () => {
    const { Hono } = await import('hono')
    const { registerSigningRoutes } = await import('../signing/signingRoutes.js')
    const { sealSession } = await import('../session/session.js')
    const { sealSessionCookie } = await import('../session/cookieSeal.js')
    const { ensureBootstrapKey } = await import('../session/sealKeys.js')
    const { env } = await import('../../env.js')
    await ensureBootstrapKey()
    const now = Math.floor(Date.now() / 1000)
    await withUserRole({
      sub: 'qa-sign',
      iss: 'http://kc.test/realms/mice',
      email: 'qa@example.com',
      name: 'QA Signer',
    })
    const sessionId = await sealSession({
      sub: 'qa-sign',
      iss: 'http://kc.test/realms/mice',
      email: 'qa@example.com',
      emailVerified: true,
      name: 'QA Signer',
      groups: [GROUP],
      authTime: now,
      sessionStart: now - 10,
      lastActive: now,
    })
    const sealed = await sealSessionCookie(sessionId)
    const app = new Hono()
    registerSigningRoutes(app, { audit: async () => {} })
    const res = await app.request('/auth/sign/prepare', {
      method: 'POST',
      headers: {
        cookie: `${env.cookieName}=${sealed}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ content: 'batch 42 released' }),
    })
    assert.equal(res.status, 503)
  })

  it('a directory failure while managing collaborators returns 503', async () => {
    const ns = 'priv-collab-down'
    assert.equal((await createNamespaceAuthz(admin, ns, 'none', true)).ok, true)
    assert.equal((await setRepoGroupCollaborator(ns, 'study', GROUP, 'admin')).ok, true)
    const holder = await withUserRole({
      sub: 'qa-down',
      iss: 'http://kc.test/realms/mice',
      email: 'qa@example.com',
      emailVerified: true,
      name: 'QA',
      groups: [GROUP],
    })
    const decision = await decideManageRepoCollaborators(holder, ns, 'study')
    assert.equal(decision.allow, false)
    assert.equal(decision.status, 503)
  })

  it('a group added in the directory does not grant a read', async () => {
    const ns = 'priv-added'
    assert.equal((await createNamespaceAuthz(admin, ns, 'none', true)).ok, true)
    assert.equal((await setRepoGroupCollaborator(ns, 'study', ADDED, 'read')).ok, true)
    const holder = await withUserRole({
      sub: 'qa-added',
      iss: 'http://kc.test/realms/mice',
      email: 'qa@example.com',
      emailVerified: true,
      name: 'QA',
      groups: [],
    })
    const read = await authorizeApiRequest({
      user: holder,
      via: 'session',
      method: 'GET',
      pathname: `/api/repos/${ns}/study`,
    })
    assert.equal(read.allow, false)
    assert.equal(read.status, 403)
  })

  it('a group removed in the directory cannot delete the namespace', async () => {
    const ns = 'priv-ns-admin'
    assert.equal((await createNamespaceAuthz(admin, ns, 'none', true)).ok, true)
    assert.equal((await setNamespaceGroupMember(ns, GROUP, 'owner')).ok, true)
    const holder = await withUserRole({
      sub: 'qa',
      iss: 'http://kc.test/realms/mice',
      email: 'qa@example.com',
      emailVerified: true,
      name: 'QA',
      groups: [GROUP],
    })
    const decision = await decideNamespaceAction(holder, ns, 'namespace.delete')
    assert.equal(decision.allow, false)
    assert.equal(decision.status, 403)
  })
})
