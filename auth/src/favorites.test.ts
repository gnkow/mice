import './db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

process.env.SESSION_SECRET = 'test-session-secret-for-favorites'

const { normalizeFavoriteType, addFavorite, listFavorites, removeFavorite, purgeFavoritesForAudit, favoriteUserKey } =
  await import('./favoritesStore.js')

const NS = '11111111-1111-4111-8111-111111111111'
const R1 = '22222222-2222-4222-8222-222222222222'
const R2 = '33333333-3333-4333-8333-333333333333'

const ev = (action: string, rest: Record<string, unknown> = {}) =>
  ({ id: '1', ts: '', actor: {}, via: 'session', method: 'DELETE', path: '/', status: 200, action, ...rest }) as never

describe('favorites store', () => {
  const a = favoriteUserKey({ iss: 'i', sub: 'a' })
  const b = favoriteUserKey({ iss: 'i', sub: 'b' })

  it('is idempotent and per user', async () => {
    assert.equal(await addFavorite(a, 'repo', R1), true)
    assert.equal(await addFavorite(a, 'repo', R1), false)
    assert.equal((await listFavorites(b)).length, 0)
    assert.equal(await removeFavorite(a, 'repo', R1), true)
    assert.equal(await removeFavorite(a, 'repo', R1), false)
  })

  it('purges on deletions for all users', async () => {
    for (const k of [a, b]) {
      await addFavorite(k, 'namespace', NS)
      await addFavorite(k, 'repo', R1)
      await addFavorite(k, 'repo', R2)
      await addFavorite(k, 'branch', `${R1}@main`)
      await addFavorite(k, 'branch', `${R2}@main`)
      await addFavorite(k, 'stage', `${R1}!w1`)
      await addFavorite(k, 'session', 'abcdef12')
    }
    await purgeFavoritesForAudit(ev('branch.delete', { repository_id: R1, detail: { branch: 'main' } }))
    assert.equal((await listFavorites(a)).some((r) => r.id === `${R1}@main`), false)
    await purgeFavoritesForAudit(ev('workspace.delete', { repository_id: R1, detail: { workspace_id: 'w1' } }))
    await purgeFavoritesForAudit(ev('session.destroy', { detail: { session_id: 'abcdef12' } }))
    await purgeFavoritesForAudit(ev('repo.delete', { repository_id: R1 }))
    assert.deepEqual((await listFavorites(b)).map((r) => r.id).sort(), [NS, R2, `${R2}@main`].sort())
    await purgeFavoritesForAudit(ev('repo.delete', { repository_id: R2, status: 500 }))
    assert.equal((await listFavorites(b)).length, 3)
    await purgeFavoritesForAudit(ev('namespace.delete', { namespace_id: NS, detail: { repository_ids: [R2] } }))
    assert.equal((await listFavorites(a)).length, 0)
  })

  it('accepts only known favorite types', () => {
    assert.equal(normalizeFavoriteType('stage'), 'stage')
    assert.equal(normalizeFavoriteType('workspace'), null)
    assert.equal(normalizeFavoriteType('bogus'), null)
  })
})
