import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import {
  fetchCommitQc,
  fetchCommitsQc,
  hasQcInvalid,
  normalizeCommitQc,
  qcStatusPillLabel,
  summarizeQcInvalid,
} from './commitQc'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

const chain = [
  { id: 'c3', parent_ids: ['c2'] },
  { id: 'c2', parent_ids: ['c1'] },
  { id: 'c1', parent_ids: [] },
]

describe('normalizeCommitQc', () => {
  it('maps greenfield and transitional aliases', () => {
    assert.equal(normalizeCommitQc('valid'), 'valid')
    assert.equal(normalizeCommitQc('invalid'), 'invalid')
    assert.equal(normalizeCommitQc('unset'), 'unset')
    assert.equal(normalizeCommitQc('passed'), 'valid')
    assert.equal(normalizeCommitQc('failed'), 'invalid')
    assert.equal(normalizeCommitQc('none'), 'unset')
    assert.equal(normalizeCommitQc('marked'), 'unset')
  })
})

describe('qcStatusPillLabel', () => {
  it('prefixes QC for history pills', () => {
    assert.equal(qcStatusPillLabel('valid'), 'QC Valid')
    assert.equal(qcStatusPillLabel('invalid'), 'QC Invalid')
    assert.equal(qcStatusPillLabel('unset'), 'QC Unset')
  })
})

describe('summarizeQcInvalid', () => {
  it('flags Invalid commits and every descendant in the list', () => {
    const s = summarizeQcInvalid(chain, { c1: 'invalid', c2: 'valid' })
    assert.deepEqual(s.invalid, ['c1'])
    assert.deepEqual(s.descendants, ['c3', 'c2'])
    assert.equal(hasQcInvalid(s), true)
  })

  it('reports nothing when no commit is Invalid', () => {
    const s = summarizeQcInvalid(chain, { c1: 'valid', c2: 'unset' })
    assert.deepEqual(s, { invalid: [], descendants: [] })
    assert.equal(hasQcInvalid(s), false)
  })

  it('treats an Invalid parent outside the list as an Invalid ancestor', () => {
    const s = summarizeQcInvalid([{ id: 'c9', parent_ids: ['c0'] }], { c0: 'invalid' })
    assert.deepEqual(s.descendants, ['c9'])
  })
})

describe('fetchCommitQc', () => {
  it('reads status from the commit QC endpoint', async () => {
    let url = ''
    globalThis.fetch = (async (input) => {
      url = String(input)
      return new Response(JSON.stringify({ commitId: 'abc', status: 'invalid' }), { status: 200 })
    }) as typeof fetch
    assert.equal(await fetchCommitQc('ns', 'repo', 'abc'), 'invalid')
    assert.equal(url, '/auth/repos/ns/repo/commits/abc/qc')
  })

  it('falls back to unset on errors so pages never block on QC', async () => {
    globalThis.fetch = (async () => new Response('{}', { status: 404 })) as typeof fetch
    assert.equal(await fetchCommitQc('ns', 'repo', 'abc'), 'unset')
  })

  it('caps the number of commits checked and dedupes ids', async () => {
    let calls = 0
    globalThis.fetch = (async () => {
      calls++
      return new Response(JSON.stringify({ status: 'valid' }), { status: 200 })
    }) as typeof fetch
    const ids = Array.from({ length: 80 }, (_, i) => `c${i}`)
    const out = await fetchCommitsQc('ns', 'repo', [...ids, ...ids])
    assert.equal(calls, 50)
    assert.equal(Object.keys(out).length, 50)
  })
})
