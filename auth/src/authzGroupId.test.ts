import './db/testSchema.js'
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
const ENGINEERING = '22222222-2222-4222-8222-222222222222'
const ISS = 'http://kc.test/realms/mice'
const GROUP_KEY = `${ISS}|${GROUP}`
const ENGINEERING_KEY = `${ISS}|${ENGINEERING}`

const { createNamespaceAuthz } = await import('./authzNamespaceStore.js')
const { setNamespaceGroupMember, listNamespaceMembers } = await import('./authzMembershipStore.js')
const { setRepoGroupCollaborator, listRepoCollaborators } = await import('./authzCollaboratorStore.js')
const { hasRepoPermission } = await import('./authz.js')
const { setDirectoryFetchForTests } = await import('./authentication/directory/directory.js')
const { createLoginFlow } = await import('./authentication/oidc/loginFlow.js')
const { getGroupDisplayName } = await import('./groupDisplayStore.js')
const { extractGroupsFromClaims, groupBindingKey } = await import('./groupBinding.js')

setDirectoryFetchForTests(async (url) => {
  const urlStr = String(url)
  if (urlStr.includes('/protocol/openid-connect/token')) {
    return new Response(JSON.stringify({ access_token: 'tok', expires_in: 60 }), { status: 200 })
  }
  if (urlStr.includes(`/groups/${GROUP}`)) {
    return new Response(JSON.stringify({ id: GROUP, name: 'Quality Team' }), { status: 200 })
  }
  if (urlStr.includes(`/groups/${ENGINEERING}`)) {
    return new Response(JSON.stringify({ id: ENGINEERING, name: 'Engineering' }), { status: 200 })
  }
  if (urlStr.includes('/users/') && urlStr.includes('/groups')) {
    return new Response(JSON.stringify([{ id: GROUP, name: 'Quality Team' }]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  if (urlStr.includes('/users/')) {
    return new Response(JSON.stringify({ enabled: true, firstName: 'Ada', lastName: 'Lovelace' }), { status: 200 })
  }
  return new Response('{}', { status: 404 })
})

const admin = {
  sub: 'admin',
  iss: 'test',
  email: 'admin@mice.local',
  emailVerified: true,
  name: 'Admin',
}

await describe('group grants bind to iss|group_id', async () => {
  await it('keeps access after a rename and shows the cached display name', async () => {
    const ns = 'gid'
    assert.equal((await createNamespaceAuthz(admin, ns, 'read', true)).ok, true)
    assert.equal((await setNamespaceGroupMember(ns, GROUP, 'member', { displayName: 'Quality Team' })).ok, true)

    const holder = { sub: 'qa', iss: ISS, email: 'qa@example.com', name: 'QA', groups: [GROUP] }
    const renamedOnly = { ...holder, groups: ['Quality Team'] }
    assert.equal((await hasRepoPermission(holder, ns, 'study', 'read')).ok, true)
    assert.equal((await hasRepoPermission(renamedOnly, ns, 'study', 'read')).ok, false)

    const members = await listNamespaceMembers(ns)
    const group = members.find((member) => member.kind === 'group')
    assert.equal(group?.kind === 'group' ? group.group : undefined, GROUP_KEY)
    assert.equal(group?.kind === 'group' ? group.name : undefined, 'Quality Team')
  })

  await it('stores directory group binding keys on the session and caches display names', async () => {
    const flow = createLoginFlow({
      provider: {
        beginLogin: async (req) => `http://idp.example/auth?state=${req.state}`,
        completeLogin: async () => ({
          sub: 'qa',
          iss: ISS,
          email: 'qa@example.com',
          name: 'QA',
          idToken: 'token',
          groups: [groupBindingKey(ISS, GROUP)],
          emailVerified: true,
        }),
        logoutUrl: async () => null,
        verifyJwt: async () => ({}),
      },
      directory: {
        configured: true,
        issuer: ISS,
        userStatus: async () => ({ status: 'enabled' as const, name: 'QA' }),
        searchUsers: async () => [],
        searchGroups: async () => [],
        getUserGroups: async () => [{ id: GROUP, name: 'Quality Team' }],
        getGroup: async () => null,
      },
    })
    const started = await flow.startLogin('/')
    const state = new URL(started.authorizeUrl).searchParams.get('state')
    const result = await flow.completeLogin({
      code: 'code',
      state: state ?? '',
      pkceCookie: started.pkceCookie,
    })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.deepEqual(result.user.groups, [GROUP_KEY])
    assert.equal(await getGroupDisplayName(GROUP_KEY), 'Quality Team')
  })

  await it('records the display name when the group grant is written', async () => {
    const { Hono } = await import('hono')
    const { registerNamespaceRoutes } = await import('./namespaceRoutes.js')
    const { sealSession } = await import('./authentication/session/session.js')
    const { sealSessionCookie } = await import('./authentication/session/cookieSeal.js')
    const { ensureBootstrapKey } = await import('./authentication/session/sealKeys.js')
    const { env } = await import('./env.js')
    const { maybeBootstrapInstanceAdmin } = await import('./authzInstanceStore.js')

    await ensureBootstrapKey()
    await maybeBootstrapInstanceAdmin(admin)
    const ns = 'auditns'
    assert.equal((await createNamespaceAuthz(admin, ns, 'read', true)).ok, true)

    const details: unknown[] = []
    const app = new Hono()
    registerNamespaceRoutes(app, {
      audit: async (_c, _u, _via, fields) => {
        details.push(fields.detail)
      },
    })
    const sessionId = await sealSession({ ...admin, sessionStart: Math.floor(Date.now() / 1000) })
    const { regulatedMutationHeaders } = await import('./testSupport.js')
    const { openSignatureStore, useSignatureStore } = await import('./authentication/signing/signatureStore.js')
    const { immudbConfig, openLedger } = await import('./auditLedger.js')
    const { randomBytes } = await import('node:crypto')
    useSignatureStore(
      openSignatureStore(
        await openLedger({ ...immudbConfig(), prefix: `group-id/${randomBytes(4).toString('hex')}/` }),
      ),
    )
    const path = `/auth/namespaces/${ns}/members`
    const body = { kind: 'group', group: GROUP, name: 'Quality Assurance', role: 'member' }
    const signed = await regulatedMutationHeaders(admin, {
      method: 'PUT',
      path,
      body,
      reason: 'Grant the quality group',
      category: 'privileged_settings',
    })
    const res = await app.request(path, {
      method: 'PUT',
      headers: {
        ...signed,
        'x-mice-change-control-id': 'CC-2026-114',
        cookie: `${env.cookieName}=${await sealSessionCookie(sessionId)}`,
      },
      body: JSON.stringify(body),
    })
    assert.equal(res.status, 200)
    assert.deepEqual(details, [
      { target: { kind: 'group', group: GROUP, name: 'Quality Assurance' }, role: 'member' },
    ])
    assert.equal(await getGroupDisplayName(GROUP_KEY), 'Quality Assurance')
  })

  await it('binds repository collaborators by iss|id and serves cached names', async () => {
    const ns = 'repofill'
    assert.equal((await createNamespaceAuthz(admin, ns, 'read', true)).ok, true)
    assert.equal(
      (await setRepoGroupCollaborator(ns, 'study', ENGINEERING, 'read', { displayName: 'Engineering' })).ok,
      true,
    )

    const collaborators = await listRepoCollaborators(ns, 'study')
    const group = collaborators.find((collaborator) => collaborator.kind === 'group')
    assert.equal(group?.kind === 'group' ? group.group : undefined, ENGINEERING_KEY)
    assert.equal(group?.kind === 'group' ? group.name : undefined, 'Engineering')

    const holder = { sub: 'eng', iss: ISS, email: 'eng@example.com', name: 'Eng', groups: [ENGINEERING] }
    assert.equal((await hasRepoPermission(holder, ns, 'study', 'read')).ok, true)
  })

  await it('extracts Azure GUID claims as id-based binding keys', () => {
    const r = extractGroupsFromClaims([GROUP, ENGINEERING], { issuer: 'https://login.microsoftonline.com/t/v2.0' })
    assert.equal(r.nameBasedFallback, false)
    assert.ok(r.groups.every((g) => g.idBased))
  })

  await it('flags name-based fallback when claims are display names', () => {
    const r = extractGroupsFromClaims(['Quality Team'], { issuer: ISS })
    assert.equal(r.nameBasedFallback, true)
    assert.equal(r.groups[0]!.idBased, false)
  })
})
