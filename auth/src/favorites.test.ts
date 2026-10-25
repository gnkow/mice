import './db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

process.env.SESSION_SECRET = 'test-session-secret-for-favorites'

const { normalizeFavoriteType, addFavorite, listFavorites, removeFavorite, purgeFavoritesForAudit, favoriteUserKey } =
  await import('./favoritesStore.js')

const ev = (action: string, rest: Record<string, unknown> = {}) =>
  ({ id: '1', ts: '', actor: {}, via: 'session', method: 'DELETE', path: '/', status: 200, action, ...rest }) as never

describe('favorites store', () => {
  const a = favoriteUserKey({ iss: 'i', sub: 'a' })
  const b = favoriteUserKey({ iss: 'i', sub: 'b' })

  it('is idempotent and per user', async () => {
    assert.equal(await addFavorite(a, 'repo', 'ns/r'), true)
    assert.equal(await addFavorite(a, 'repo', 'ns/r'), false)
    assert.equal((await listFavorites(b)).length, 0)
    assert.equal(await removeFavorite(a, 'repo', 'ns/r'), true)
    assert.equal(await removeFavorite(a, 'repo', 'ns/r'), false)
  })

  it('purges on deletions for all users', async () => {
    for (const k of [a, b]) {
      await addFavorite(k, 'namespace', 'ns')
      await addFavorite(k, 'repo', 'ns/r')
      await addFavorite(k, 'repo', 'ns/r2')
      await addFavorite(k, 'branch', 'ns/r@main')
      await addFavorite(k, 'branch', 'ns/r2@main')
      await addFavorite(k, 'stage', 'ns/r!w1')
      await addFavorite(k, 'session', 'abcdef12')
    }
    await purgeFavoritesForAudit(ev('branch.delete', { namespace: 'ns', repo: 'r', detail: { branch: 'main' } }))
    assert.equal((await listFavorites(a)).some((r) => r.id === 'ns/r@main'), false)
    await purgeFavoritesForAudit(ev('workspace.delete', { namespace: 'ns', repo: 'r', detail: { workspace_id: 'w1' } }))
    await purgeFavoritesForAudit(ev('session.destroy', { detail: { session_id: 'abcdef12' } }))
    await purgeFavoritesForAudit(ev('repo.delete', { namespace: 'ns', repo: 'r' }))
    assert.deepEqual((await listFavorites(b)).map((r) => r.id).sort(), ['ns', 'ns/r2', 'ns/r2@main'])
    await purgeFavoritesForAudit(ev('repo.delete', { namespace: 'ns', repo: 'r2', status: 500 }))
    assert.equal((await listFavorites(b)).length, 3)
    await purgeFavoritesForAudit(ev('namespace.delete', { namespace: 'ns' }))
    assert.equal((await listFavorites(a)).length, 0)
  })

  it('accepts only known favorite types', () => {
    assert.equal(normalizeFavoriteType('stage'), 'stage')
    assert.equal(normalizeFavoriteType('workspace'), null)
    assert.equal(normalizeFavoriteType('bogus'), null)
  })
})
