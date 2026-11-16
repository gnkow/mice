import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { fetchCommitQc, fetchCommitsQc, hasQcFailures, summarizeQcFailures } from './commitQc'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

const chain = [
  { id: 'c3', parent_ids: ['c2'] },
  { id: 'c2', parent_ids: ['c1'] },
  { id: 'c1', parent_ids: [] },
]

describe('summarizeQcFailures', () => {
  it('flags failed commits and every descendant in the list', () => {
    const s = summarizeQcFailures(chain, { c1: 'failed', c2: 'passed' })
    assert.deepEqual(s.failed, ['c1'])
    assert.deepEqual(s.descendants, ['c3', 'c2'])
    assert.equal(hasQcFailures(s), true)
  })

  it('reports nothing when no commit failed', () => {
    const s = summarizeQcFailures(chain, { c1: 'passed', c2: 'marked' })
    assert.deepEqual(s, { failed: [], descendants: [] })
    assert.equal(hasQcFailures(s), false)
  })

  it('treats a failed parent outside the list as a failure ancestor', () => {
    const s = summarizeQcFailures([{ id: 'c9', parent_ids: ['c0'] }], { c0: 'failed' })
    assert.deepEqual(s.descendants, ['c9'])
  })
})

describe('fetchCommitQc', () => {
  it('reads status from the commit QC endpoint', async () => {
    let url = ''
    globalThis.fetch = (async (input) => {
      url = String(input)
      return new Response(JSON.stringify({ commitId: 'abc', status: 'failed' }), { status: 200 })
    }) as typeof fetch
    assert.equal(await fetchCommitQc('ns', 'repo', 'abc'), 'failed')
    assert.equal(url, '/auth/repos/ns/repo/commits/abc/qc')
  })

  it('falls back to none on errors so pages never block on QC', async () => {
    globalThis.fetch = (async () => new Response('{}', { status: 404 })) as typeof fetch
    assert.equal(await fetchCommitQc('ns', 'repo', 'abc'), 'none')
  })

  it('caps the number of commits checked and dedupes ids', async () => {
    let calls = 0
    globalThis.fetch = (async () => {
      calls++
      return new Response(JSON.stringify({ status: 'passed' }), { status: 200 })
    }) as typeof fetch
    const ids = Array.from({ length: 80 }, (_, i) => `c${i}`)
    const out = await fetchCommitsQc('ns', 'repo', [...ids, ...ids])
    assert.equal(calls, 50)
    assert.equal(Object.keys(out).length, 50)
  })
})
