import './db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

const { parseRef, refKey, MetaError } = await import('./metaTypes.js')
const { resolveEffective } = await import('./metaResolve.js')
const { putOwnRecord, getOwnRecord, getRevision, deleteOwnRecord, listHistory, listOwnRecords } = await import('./metaStore.js')
const { searchMeta, parseQuerySyntax } = await import('./metaSearch.js')
const actor = { sub: 's1', email: 'a@x.io', name: 'Ann', iss: 'iss' }

describe('explicit metadata', () => {
  const refs = [
    parseRef('namespace', 'acme'), parseRef('repo', 'acme/data'),
    parseRef('branch', 'acme/data@main'), parseRef('commit', 'acme/data#abc'),
    parseRef('directory', 'acme/data:images/'), parseRef('file', 'acme/data:images/a.png'),
    parseRef('workspace', 'acme/data!w1'), parseRef('job', 'j1'), parseRef('session', 's1'),
  ]
  for (const ref of refs) {
    it(`supports independent CRUD for ${ref.type}`, async () => {
      assert.deepEqual((await resolveEffective(ref, getOwnRecord)).effective, { tags: [], labels: {} })
      await putOwnRecord(ref, { tags: ['reviewed'], labels: { owner: ref.type, empty: '' } }, actor)
      assert.deepEqual((await resolveEffective(ref, getOwnRecord)).effective.tags, [{ value: 'reviewed' }])
      assert.equal((await resolveEffective(ref, getOwnRecord)).effective.labels.owner.value, ref.type)
      await putOwnRecord(ref, { tags: ['edited'], labels: { owner: null, renamed: 'team' } }, actor)
      assert.equal((await getOwnRecord(ref))?.labels.owner, undefined)
      assert.equal((await getOwnRecord(ref))?.labels.empty, '')
      assert.equal((await getOwnRecord(ref))?.labels.renamed, 'team')
      await deleteOwnRecord(ref, actor)
      assert.equal(await getOwnRecord(ref), null)
      assert.equal((await listHistory(ref)).length, 3)
    })
  }

  it('never merges metadata from related entities', async () => {
    for (const ref of refs) await putOwnRecord(ref, { tags: [ref.type], labels: { owner: ref.type } }, actor)
    for (const ref of refs) {
      assert.deepEqual((await resolveEffective(ref, getOwnRecord)).effective, {
        tags: [{ value: ref.type }], labels: { owner: { value: ref.type } },
      })
    }
    const unannotated = parseRef('file', 'acme/data:images/b.png')
    assert.deepEqual((await resolveEffective(unannotated, getOwnRecord)).effective, { tags: [], labels: {} })
  })

  for (const type of ['file', 'directory'] as const) {
    it(`keeps general, branch, and commit ${type} scopes fully independent`, async () => {
      const id = `scopes/data:images/${type === 'file' ? 'a.png' : ''}`
      const refs = [
        parseRef(type, id), parseRef(type, id, { kind: 'branch', id: 'main' }),
        parseRef(type, id, { kind: 'branch', id: 'dev' }), parseRef(type, id, { kind: 'commit', id: 'abc' }),
      ]
      for (const [i, ref] of refs.entries()) await putOwnRecord(ref, { labels: { scope: String(i) } }, actor)
      for (const [i, ref] of refs.entries()) assert.equal((await resolveEffective(ref, getOwnRecord)).effective.labels.scope.value, String(i))
      await deleteOwnRecord(refs[1], actor)
      assert.deepEqual((await resolveEffective(refs[1], getOwnRecord)).effective, { tags: [], labels: {} })
      assert.equal((await resolveEffective(refs[0], getOwnRecord)).effective.labels.scope.value, '0')
    })
  }

  it('does not collide scoped identities with valid filenames', async () => {
    assert.notEqual(refKey(parseRef('file', 'scope/data:x?scope=branch&revision=main')), refKey(parseRef('file', 'scope/data:x', { kind: 'branch', id: 'main' })))
  })

  it('rejects invalid refs and noncanonical paths', async () => {
    for (const [type, id] of [['widget', 'x'], ['file', 'acme/data:../a'], ['directory', 'acme/data:images'], ['file', 'acme/data:a/']]) {
      assert.throws(() => parseRef(type, id), MetaError)
    }
    assert.throws(() => parseRef('repo', 'acme/data', { kind: 'branch', id: 'main' }), MetaError)
  })
})

describe('storage and concurrency', () => {
  const ref = parseRef('repo', 'store/data')
  it('validates inputs, limits, and removed inheritance options', async () => {
    for (const patch of [
      { tags: ['Bad Tag'] }, { labels: { 'bad key': 'x' } }, { labels: { valid: 42 } },
      { tags: Array.from({ length: 51 }, (_, i) => `tag${i}`) },
      { labels: { valid: 'x'.repeat(2049) } }, { inherit: false },
      { propagation: {} }, { removeTags: ['old'] }, { unset: { labels: ['old'] } },
    ]) await assert.rejects(() => putOwnRecord(ref, JSON.parse(JSON.stringify(patch)), actor), MetaError)
  })
  it('preserves unrelated labels and physically removes keys', async () => {
    await putOwnRecord(ref, { tags: ['one'], labels: { first: '1', second: '2' } }, actor)
    await putOwnRecord(ref, { tags: [], labels: { first: null, third: '' } }, actor)
    assert.deepEqual((await getOwnRecord(ref))?.labels, { second: '2', third: '' })
    assert.deepEqual((await getOwnRecord(ref))?.tags, [])
  })
  it('rejects stale writes and deletes, keeping revisions monotonic', async () => {
    const revision = await getRevision(ref)
    await putOwnRecord(ref, { labels: { current: 'yes' } }, actor, revision)
    await assert.rejects(() => putOwnRecord(ref, { tags: ['stale'] }, actor, revision), /Revision conflict/)
    await assert.rejects(() => deleteOwnRecord(ref, actor, revision), /Revision conflict/)
    await deleteOwnRecord(ref, actor, revision + 1)
    await putOwnRecord(ref, { tags: ['new'] }, actor, revision + 2)
    assert.equal(await getRevision(ref), revision + 3)
  })
  it('lets only one of two concurrent edits with the same revision win', async () => {
    const ref = parseRef('repo', 'race/data')
    const results = await Promise.allSettled([
      putOwnRecord(ref, { tags: ['a'] }, actor, 0),
      putOwnRecord(ref, { tags: ['b'] }, actor, 0),
    ])
    assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected'])
    assert.equal(await getRevision(ref), 1)
    assert.equal((await listHistory(ref)).length, 1)
  })
  it('drops empty records without losing history or revisions', async () => {
    const ref = parseRef('repo', 'empty/data')
    await putOwnRecord(ref, { tags: ['only'] }, actor)
    await putOwnRecord(ref, { tags: [] }, actor)
    assert.equal(await getOwnRecord(ref), null)
    assert.equal(await getRevision(ref), 2)
    assert.equal((await listHistory(ref))[0].op, 'delete')
  })
  it("lists one entity's history without reading other entities' revisions", async () => {
    const a = parseRef('repo', 'hist/a')
    const b = parseRef('repo', 'hist/b')
    await putOwnRecord(a, { tags: ['one'] }, actor)
    await putOwnRecord(b, { tags: ['one'] }, actor)
    await putOwnRecord(a, { tags: ['two'] }, actor)
    assert.deepEqual((await listHistory(a)).map((h) => h.revision), [2, 1])
    assert.deepEqual((await listHistory(b)).map((h) => h.revision), [1])
  })
})

describe('explicit metadata search', () => {
  const parent = parseRef('namespace', 'search')
  const child = parseRef('repo', 'search/data')
  it('matches only annotations on the exact resource', async () => {
    await putOwnRecord(parent, { tags: ['parent'], labels: { owner: 'parent' } }, actor)
    await putOwnRecord(child, { tags: ['child'], labels: { owner: 'child' } }, actor)
    const ctx = { candidates: [parent, child, parseRef('file', 'search/data:a')], getOwn: getOwnRecord, canRead: () => true }
    assert.deepEqual((await searchMeta({ tags: ['parent'] }, ctx)).hits.map(h => h.ref.id), ['search'])
    assert.deepEqual((await searchMeta({ labels: { owner: 'child' } }, ctx)).hits.map(h => h.ref.id), ['search/data'])
    assert.equal((await searchMeta({}, ctx)).total, 2)
    assert.equal((await searchMeta({}, { ...ctx, canRead: r => r.type !== 'namespace' })).total, 1)
  })
  it('supports scoped results, query syntax, facets, and pagination', async () => {
    const ctx = { candidates: (await listOwnRecords()).map(r => r.ref), getOwn: getOwnRecord, canRead: () => true }
    const first = await searchMeta({ limit: 1 }, ctx)
    const second = await searchMeta({ limit: 1, cursor: first.nextCursor ?? undefined }, ctx)
    assert.notEqual(refKey(first.hits[0].ref), refKey(second.hits[0].ref))
    assert.ok(first.facets.types.repo)
    assert.deepEqual(parseQuerySyntax('tag:child type:repo label.owner:child hello'), { text: 'hello', types: ['repo'], tags: ['child'], labels: { owner: 'child' } })
    assert.equal((await searchMeta({ q: 'tag:child type:repo label.owner:child' }, ctx)).total, 1)
    assert.ok((await searchMeta({ types: ['file'] }, ctx)).hits.some(h => h.ref.scope?.kind === 'commit'))
  })
})
