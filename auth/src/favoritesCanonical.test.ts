import './db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { isolatedAuth } from './testSupport.js'

const iso = isolatedAuth({ OXEN_UPSTREAM: 'http://oxen.invalid' })
after(() => iso.restore())

const { canonicalizeFavorite } = await import('./favoritesCanonical.js')
const { createNamespaceAuthz } = await import('./authzNamespaceStore.js')
const { ensureRepository } = await import('./repositoryStore.js')
const { listFavorites, favoriteUserKey } = await import('./favoritesStore.js')
const { createApp } = await import('./app.js')

const owner = iso.person('fav-owner')
await iso.grantRole(owner, 'manager')
const app = createApp()

describe('canonicalizeFavorite', () => {
  it('stores namespace and repo favorites as entity UUIDs', async () => {
    assert.deepEqual(await createNamespaceAuthz(owner, 'fav-ns', 'none'), { ok: true })
    const repo = await ensureRepository('fav-ns', 'data')
    assert.ok(repo)
    const ns = await canonicalizeFavorite('namespace', 'fav-ns')
    assert.ok(ns)
    assert.equal(ns.id, repo.namespaceId)
    assert.equal(ns.metaId, 'fav-ns')
    assert.equal((await canonicalizeFavorite('namespace', ns.id))?.id, ns.id)

    const asPath = await canonicalizeFavorite('repo', 'fav-ns/data')
    assert.ok(asPath)
    assert.equal(asPath.id, repo.id)
    assert.equal(asPath.metaId, 'fav-ns/data')
    assert.equal((await canonicalizeFavorite('repo', repo.id))?.id, repo.id)
  })

  it('embeds repository_id in branch and stage favorite keys', async () => {
    assert.deepEqual(await createNamespaceAuthz(owner, 'fav-br', 'none'), { ok: true })
    const repo = await ensureRepository('fav-br', 'study')
    assert.ok(repo)
    assert.deepEqual(await canonicalizeFavorite('branch', 'fav-br/study@main'), {
      id: `${repo.id}@main`,
      metaId: 'fav-br/study@main',
      namespace: 'fav-br',
      repo: 'study',
    })
    const stage = await canonicalizeFavorite('stage', `${repo.id}!ws1`)
    assert.equal(stage?.id, `${repo.id}!ws1`)
    assert.equal(stage?.metaId, 'fav-br/study!ws1')
  })
})

describe('PUT /auth/favorites stores entity UUIDs', () => {
  it('rewrites a name-path namespace favorite to the namespace UUID', async () => {
    assert.deepEqual(await createNamespaceAuthz(owner, 'fav-http', 'none'), { ok: true })
    const ns = await canonicalizeFavorite('namespace', 'fav-http')
    assert.ok(ns)
    const res = await app.request('/auth/favorites', {
      method: 'PUT',
      headers: {
        ...(await iso.sessionHeaders(owner)),
        'content-type': 'application/json',
        'x-mice-reason': 'Routine test change',
        'x-mice-reason-category': 'privileged_settings',
        'x-mice-change-control-id': 'CC-2026-114',
      },
      body: JSON.stringify({ type: 'namespace', id: 'fav-http' }),
    })
    assert.equal(res.status, 201)
    const body = (await res.json()) as { id: string; namespace?: string }
    assert.equal(body.id, ns.id)
    assert.equal(body.namespace, 'fav-http')
    const stored = await listFavorites(favoriteUserKey(owner))
    assert.ok(stored.some((r) => r.type === 'namespace' && r.id === ns.id))
  })
})
