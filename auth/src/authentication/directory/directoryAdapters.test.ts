import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { fakeClock } from '../../clock.js'
import { isolatedAuth } from '../../testSupport.js'

const t = isolatedAuth()
after(() => t.restore())

const { createKeycloakDirectory } = await import('./directoryKeycloak.js')
const { createFakeDirectory } = await import('./directoryFake.js')
const { createDirectoryService } = await import('./directory.js')
const { setNamespaceMember } = await import('../../authzMembershipStore.js')
const { createNamespaceAuthz } = await import('../../authzNamespaceStore.js')

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('Keycloak directory adapter', () => {
  const config = {
    adminUrl: 'http://kc.test',
    realm: 'mice',
    clientId: 'mice-auth',
    clientSecret: 's3cret',
    issuer: 'http://kc.test/realms/mice',
  }

  function setup() {
    const clock = fakeClock()
    const calls: string[] = []
    const fetchFn: typeof fetch = async (input) => {
      const url = String(input)
      calls.push(url)
      if (url.endsWith('/token')) return json({ access_token: 'tok', expires_in: 60 })
      if (url.includes('/users/missing')) return json({}, 404)
      if (url.includes('/users/off')) return json({ enabled: false })
      if (url.includes('/users/on')) return json({ enabled: true })
      if (url.includes('/users?')) {
        return json([
          { id: 'u1', username: 'ann', email: 'ann@x.io', firstName: 'Ann', lastName: 'Lee', enabled: true },
          { id: 'u2', username: 'gone', enabled: false },
        ])
      }
      if (url.includes('/groups?')) return json([{ name: 'Devs' }, { path: '/org/ops' }])
      return json({}, 404)
    }
    return { clock, calls, directory: createKeycloakDirectory(config, { fetch: fetchFn, clock }) }
  }

  it('searches enabled users and maps groups to their leaf name', async () => {
    const { directory } = setup()
    assert.deepEqual(await directory.searchUsers('a', 10), [
      { kind: 'user', sub: 'u1', iss: 'http://kc.test/realms/mice', email: 'ann@x.io', name: 'Ann Lee' },
    ])
    assert.deepEqual(await directory.searchGroups('d', 10), [
      { kind: 'group', group: 'devs', name: 'devs' },
      { kind: 'group', group: 'ops', name: 'ops' },
    ])
  })

  it('reports user status', async () => {
    const { directory } = setup()
    assert.equal(await directory.userStatus('on'), 'enabled')
    assert.equal(await directory.userStatus('off'), 'disabled')
    assert.equal(await directory.userStatus('missing'), 'missing')
  })

  it('caches its token per instance until shortly before expiry', async () => {
    const { clock, calls, directory } = setup()
    await directory.searchUsers('a', 10)
    await directory.searchUsers('a', 10)
    assert.equal(calls.filter((c) => c.endsWith('/token')).length, 1)
    clock.advance(56_000)
    await directory.searchUsers('a', 10)
    assert.equal(calls.filter((c) => c.endsWith('/token')).length, 2)
  })

  it('is unconfigured without an admin URL and answers error/empty', async () => {
    const directory = createKeycloakDirectory({ ...config, adminUrl: '' })
    assert.equal(directory.configured, false)
    assert.deepEqual(await directory.searchUsers('a', 10), [])
    assert.equal(await directory.userStatus('x'), 'error')
  })
})

describe('directory search service over a fake Directory', async () => {
  const created = await createNamespaceAuthz({ ...t.admin }, 'ns-a', 'none', true)
  assert.equal(created.ok, true)
  await setNamespaceMember('ns-a', { sub: 'local-lee', iss: 'test' }, 'member')

  it('merges directory and local hits as mixed', async () => {
    const directory = createFakeDirectory({
      users: [{ kind: 'user', sub: 'kc-lee', iss: 'test', email: 'lee@x.io', name: 'Lee K' }],
    })
    const res = await createDirectoryService(directory).search({ q: 'lee', kind: 'user', limit: 10 })
    assert.equal(res.source, 'mixed')
    assert.equal(res.providerConfigured, true)
    assert.deepEqual(res.results.map((r) => r.kind === 'user' && r.sub).sort(), ['kc-lee', 'local-lee'])
  })

  it('falls back to the local projection when no provider is configured', async () => {
    const res = await createDirectoryService(createFakeDirectory({ configured: false })).search({ q: 'lee' })
    assert.equal(res.source, 'store')
    assert.equal(res.providerConfigured, false)
  })
})
