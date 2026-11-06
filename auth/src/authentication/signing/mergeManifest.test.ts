import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { describe, it } from 'node:test'
import {
  buildMergeManifest,
  createManifestCache,
  manifestForCommit,
  type ManifestEntry,
  type TreeLister,
} from './mergeManifest.js'

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

describe('buildMergeManifest', () => {
  it('sorts paths and digests the canonical path-hash lines', () => {
    const { manifest, digest } = buildMergeManifest([
      { path: 'b.csv', contentHash: '22bb' },
      { path: 'a.csv', contentHash: '11aa' },
    ])
    assert.equal(manifest, 'a.csv 11aa\nb.csv 22bb\n')
    assert.equal(digest, sha('a.csv 11aa\nb.csv 22bb\n'))
  })

  it('is empty for an empty tree', () => {
    const { manifest, digest } = buildMergeManifest([])
    assert.equal(manifest, '')
    assert.equal(digest, sha(''))
  })
})

describe('manifestForCommit', () => {
  it('lists the tree once, returns the digest, and reuses the cache for the same commit', async () => {
    let calls = 0
    const trees = new Map<string, ManifestEntry[]>([
      ['c1', [{ path: 'a.csv', contentHash: '11aa' }]],
      ['c2', [{ path: 'a.csv', contentHash: '11aa' }, { path: 'b.csv', contentHash: '22bb' }]],
    ])
    const listTree: TreeLister = async (_ns, _repo, commit) => {
      calls += 1
      return trees.get(commit) ?? []
    }
    const cache = createManifestCache()
    const repo = { namespace: 'ns', repo: 'data' }

    const first = await manifestForCommit(repo, 'c1', { listTree, cache })
    assert.equal(first.digest, sha('a.csv 11aa\n'))
    assert.equal(first.manifest, 'a.csv 11aa\n')
    assert.equal(calls, 1)

    const cached = await manifestForCommit(repo, 'c1', { listTree, cache })
    assert.equal(cached.digest, first.digest)
    assert.equal(calls, 1)

    const next = await manifestForCommit(repo, 'c2', { listTree, cache })
    assert.equal(next.digest, sha('a.csv 11aa\nb.csv 22bb\n'))
    assert.equal(calls, 2)
  })

  it('builds a digest that signature binding can use as content evidence', () => {
    const { manifest, digest } = buildMergeManifest([
      { path: 'results.csv', contentHash: 'aabb' },
    ])
    assert.equal(digest, sha(manifest))
    assert.match(digest, /^[0-9a-f]{64}$/)
  })
})
