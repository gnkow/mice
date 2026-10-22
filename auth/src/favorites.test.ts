import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

const dataDir = mkdtempSync(join(tmpdir(), 'mice-fav-'))
process.env.AUTH_DATA_DIR = dataDir
process.env.SESSION_SECRET = 'test-session-secret-for-favorites'

const { addFavorite, listFavorites, removeFavorite, purgeFavoritesForAudit, favoriteUserKey } =
  await import('./favoritesStore.js')

const ev = (action: string, rest: Record<string, unknown> = {}) =>
  ({ id: '1', ts: '', actor: {}, via: 'session', method: 'DELETE', path: '/', status: 200, action, ...rest }) as never

describe('favorites store', () => {
  after(() => rmSync(dataDir, { recursive: true, force: true }))
  const a = favoriteUserKey({ iss: 'i', sub: 'a' })
  const b = favoriteUserKey({ iss: 'i', sub: 'b' })

  it('is idempotent and per user', () => {
    assert.equal(addFavorite(a, 'repo', 'ns/r'), true)
    assert.equal(addFavorite(a, 'repo', 'ns/r'), false)
    assert.equal(listFavorites(b).length, 0)
    assert.equal(removeFavorite(a, 'repo', 'ns/r'), true)
    assert.equal(removeFavorite(a, 'repo', 'ns/r'), false)
  })

  it('purges on deletions for all users', () => {
    for (const k of [a, b]) {
      addFavorite(k, 'namespace', 'ns')
      addFavorite(k, 'repo', 'ns/r')
      addFavorite(k, 'repo', 'ns/r2')
      addFavorite(k, 'branch', 'ns/r@main')
      addFavorite(k, 'branch', 'ns/r2@main')
      addFavorite(k, 'workspace', 'ns/r!w1')
      addFavorite(k, 'session', 'abcdef12')
    }
    purgeFavoritesForAudit(ev('branch.delete', { namespace: 'ns', repo: 'r', detail: { branch: 'main' } }))
    assert.equal(listFavorites(a).some((r) => r.id === 'ns/r@main'), false)
    purgeFavoritesForAudit(ev('workspace.delete', { namespace: 'ns', repo: 'r', detail: { workspace_id: 'w1' } }))
    purgeFavoritesForAudit(ev('session.destroy', { detail: { session_id: 'abcdef12' } }))
    purgeFavoritesForAudit(ev('repo.delete', { namespace: 'ns', repo: 'r' }))
    assert.deepEqual(listFavorites(b).map((r) => r.id).sort(), ['ns', 'ns/r2', 'ns/r2@main'])
    purgeFavoritesForAudit(ev('repo.delete', { namespace: 'ns', repo: 'r2', status: 500 }))
    assert.equal(listFavorites(b).length, 3)
    purgeFavoritesForAudit(ev('namespace.delete', { namespace: 'ns' }))
    assert.equal(listFavorites(a).length, 0)
  })
})
