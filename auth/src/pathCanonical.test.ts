import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { nonCanonicalPathReason } from './pathCanonical.js'

describe('path canonicalisation', () => {
  it('accepts ordinary API paths, including trailing slash and encoded names', () => {
    for (const p of [
      '/api/version',
      '/api/repos/ns/r/file/main/a%20b.txt',
      '/api/repos/ns/r/',
      '/api/repos/ns/r/file/main/%C3%A9.csv',
    ]) {
      assert.equal(nonCanonicalPathReason(p), null, p)
    }
  })

  it('rejects separators and ambiguous forms', () => {
    for (const p of [
      '/api/repos//ns/r',
      '/api/repos/ns%2Fx/r',
      '/api/repos/ns%5cx/r',
      '/api/repos\\ns/r',
      '/api/repos/ns/%2e%2e/other',
      '/api/repos/ns/r/%00',
      '/api/repos/ns/r/%E0%A4%A',
    ]) {
      assert.notEqual(nonCanonicalPathReason(p), null, p)
    }
  })

  it('treats literal dot segments as already resolved by URL parsing', () => {
    assert.equal(new URL('http://x/api/repos/a/../b/r').pathname, '/api/repos/b/r')
    assert.equal(new URL('http://x/api/repos/a/%2e%2e/b/r').pathname, '/api/repos/b/r')
  })
})
