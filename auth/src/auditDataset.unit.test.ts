import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildDatasetVersions,
  createDatasetCapture,
  datasetTarget,
  headFromAnswer,
  VERSIONED_ACTIONS,
} from './auditDataset.js'

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
const fail = (status = 404) => new Response('{}', { status, headers: { 'content-type': 'application/json' } })

describe('datasetTarget', () => {
  it('parses file and branch paths', () => {
    assert.deepEqual(datasetTarget('/api/repos/ns/r/file/main/a.csv'), {
      namespace: 'ns',
      repo: 'r',
      branch: 'main',
    })
    assert.deepEqual(datasetTarget('/api/repos/ns/r/branches/main'), {
      namespace: 'ns',
      repo: 'r',
      branch: 'main',
    })
  })

  it('parses merge ranges (destination branch is base)', () => {
    assert.deepEqual(datasetTarget('/api/repos/ns/r/merge/main..feature'), {
      namespace: 'ns',
      repo: 'r',
      branch: 'main',
    })
    assert.deepEqual(datasetTarget('/api/repos/ns/r/merges/develop..topic'), {
      namespace: 'ns',
      repo: 'r',
      branch: 'develop',
    })
  })

  it('parses commit.publish paths as publishedCommit (no branch base)', () => {
    assert.deepEqual(datasetTarget('/api/repos/ns/r/commits/abc123/complete'), {
      namespace: 'ns',
      repo: 'r',
      publishedCommit: 'abc123',
    })
  })

  it('parses workspace commit/merge branch targets', () => {
    assert.deepEqual(datasetTarget('/api/repos/ns/r/workspaces/ws1/commit/main'), {
      namespace: 'ns',
      repo: 'r',
      branch: 'main',
    })
    assert.deepEqual(datasetTarget('/api/repos/ns/r/workspaces/ws1/merge/main'), {
      namespace: 'ns',
      repo: 'r',
      branch: 'main',
    })
  })
})

describe('headFromAnswer', () => {
  it('reads commit, branch, and merge answer shapes', () => {
    assert.equal(headFromAnswer(JSON.stringify({ commit: { id: 'c1' } })), 'c1')
    assert.equal(headFromAnswer(JSON.stringify({ branch: { commit_id: 'b9' } })), 'b9')
    assert.equal(
      headFromAnswer(JSON.stringify({ commits: { merge: { id: 'm1' } } })),
      'm1',
    )
  })

  it('returns undefined for invalid or empty answers', () => {
    assert.equal(headFromAnswer(undefined), undefined)
    assert.equal(headFromAnswer('not-json'), undefined)
    assert.equal(headFromAnswer(JSON.stringify({ status: 'ok' })), undefined)
    assert.equal(headFromAnswer(JSON.stringify({ commit: { id: '  ' } })), undefined)
  })
})

describe('buildDatasetVersions', () => {
  it('omits versions when action does not apply or upstream refused', () => {
    assert.deepEqual(buildDatasetVersions({ applies: false, upstreamOk: true, base: 'a', head: 'b' }), {})
    assert.deepEqual(buildDatasetVersions({ applies: true, upstreamOk: false, base: 'a', head: 'b' }), {})
  })

  it('marks unverified when head is missing', () => {
    assert.deepEqual(buildDatasetVersions({ applies: true, upstreamOk: true, base: 'c0' }), {
      dataset: { base: 'c0' },
      unverified: true,
    })
  })

  it('returns base and head when both known', () => {
    assert.deepEqual(
      buildDatasetVersions({ applies: true, upstreamOk: true, base: 'c0', head: 'c1' }),
      { dataset: { base: 'c0', head: 'c1' } },
    )
  })
})

describe('createDatasetCapture', () => {
  it('captures base from branch tip then head from commit answer (file write)', async () => {
    const capture = createDatasetCapture({
      method: 'PUT',
      pathname: '/api/repos/ns/r/file/main/a.csv',
      action: 'file.write',
      oxenUpstream: 'http://oxen.test',
      fetchImpl: async (url) => {
        assert.match(String(url), /\/branches\/main$/)
        return ok({ branch: { name: 'main', commit_id: 'c0' } })
      },
    })
    await capture.before()
    assert.deepEqual(capture.after(ok({ commit: { id: 'c1' } }), JSON.stringify({ commit: { id: 'c1' } })), {
      dataset: { base: 'c0', head: 'c1' },
    })
  })

  it('captures head from branch.update answer', async () => {
    const capture = createDatasetCapture({
      method: 'PUT',
      pathname: '/api/repos/ns/r/branches/main',
      action: 'branch.update',
      oxenUpstream: 'http://oxen.test',
      fetchImpl: async () => ok({ branch: { name: 'main', commit_id: 'c0' } }),
    })
    await capture.before()
    const text = JSON.stringify({ branch: { name: 'main', commit_id: 'c9' } })
    assert.deepEqual(capture.after(ok({}), text), { dataset: { base: 'c0', head: 'c9' } })
  })

  it('captures head from merge answer', async () => {
    const capture = createDatasetCapture({
      method: 'POST',
      pathname: '/api/repos/ns/r/merge/main..feature',
      action: 'merge',
      oxenUpstream: 'http://oxen.test',
      fetchImpl: async () => ok({ branch: { name: 'main', commit_id: 'c0' } }),
    })
    await capture.before()
    const text = JSON.stringify({ commits: { base: { id: 'a' }, head: { id: 'b' }, merge: { id: 'm1' } } })
    assert.deepEqual(capture.after(ok({}), text), { dataset: { base: 'c0', head: 'm1' } })
  })

  it('uses publishedCommit as head for commit.publish (no branch base fetch)', async () => {
    let fetches = 0
    const capture = createDatasetCapture({
      method: 'POST',
      pathname: '/api/repos/ns/r/commits/c77/complete',
      action: 'commit.publish',
      oxenUpstream: 'http://oxen.test',
      fetchImpl: async () => {
        fetches++
        return fail()
      },
    })
    await capture.before()
    assert.equal(fetches, 0)
    assert.deepEqual(capture.after(ok({ status: 'ok' }), JSON.stringify({ status: 'ok' })), {
      dataset: { head: 'c77' },
    })
  })

  it('returns empty for non-versioned actions', async () => {
    const capture = createDatasetCapture({
      method: 'DELETE',
      pathname: '/api/repos/ns/r/branches/old',
      action: 'branch.delete',
      oxenUpstream: 'http://oxen.test',
      fetchImpl: async () => ok({ branch: { commit_id: 'c0' } }),
    })
    await capture.before()
    assert.deepEqual(capture.after(ok({}), '{}'), {})
    assert.equal(VERSIONED_ACTIONS.has('branch.delete'), false)
  })
})
