import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

const dataDir = mkdtempSync(join(tmpdir(), 'mice-meta-'))
process.env.AUTH_DATA_DIR = dataDir
const { parseRef, refKey, MetaError } = await import('./metaTypes.js')
const { resolveEffective } = await import('./metaResolve.js')
const { putOwnRecord, getOwnRecord, getRevision, deleteOwnRecord, listHistory, listOwnRecords } = await import('./metaStore.js')
const { searchMeta, parseQuerySyntax } = await import('./metaSearch.js')
const actor = { sub: 's1', email: 'a@x.io', name: 'Ann', iss: 'iss' }
after(() => rmSync(dataDir, { recursive: true, force: true }))

describe('explicit metadata', () => {
  const refs = [
    parseRef('namespace', 'acme'), parseRef('repo', 'acme/data'),
    parseRef('branch', 'acme/data@main'), parseRef('commit', 'acme/data#abc'),
    parseRef('directory', 'acme/data:images/'), parseRef('file', 'acme/data:images/a.png'),
    parseRef('workspace', 'acme/data!w1'), parseRef('job', 'j1'), parseRef('session', 's1'),
  ]
  for (const ref of refs) {
    it(`supports independent CRUD for ${ref.type}`, () => {
      assert.deepEqual(resolveEffective(ref, getOwnRecord).effective, { tags: [], labels: {} })
      putOwnRecord(ref, { tags: ['reviewed'], labels: { owner: ref.type, empty: '' } }, actor)
      assert.deepEqual(resolveEffective(ref, getOwnRecord).effective.tags, [{ value: 'reviewed' }])
      assert.equal(resolveEffective(ref, getOwnRecord).effective.labels.owner.value, ref.type)
      putOwnRecord(ref, { tags: ['edited'], labels: { owner: null, renamed: 'team' } }, actor)
      assert.equal(getOwnRecord(ref)?.labels.owner, undefined)
      assert.equal(getOwnRecord(ref)?.labels.empty, '')
      assert.equal(getOwnRecord(ref)?.labels.renamed, 'team')
      deleteOwnRecord(ref, actor)
      assert.equal(getOwnRecord(ref), null)
      assert.equal(listHistory(ref).length, 3)
    })
  }

  it('never merges metadata from related entities', () => {
    for (const ref of refs) putOwnRecord(ref, { tags: [ref.type], labels: { owner: ref.type } }, actor)
    for (const ref of refs) {
      assert.deepEqual(resolveEffective(ref, getOwnRecord).effective, {
        tags: [{ value: ref.type }], labels: { owner: { value: ref.type } },
      })
    }
    const unannotated = parseRef('file', 'acme/data:images/b.png')
    assert.deepEqual(resolveEffective(unannotated, getOwnRecord).effective, { tags: [], labels: {} })
  })

  for (const type of ['file', 'directory'] as const) {
    it(`keeps general, branch, and commit ${type} scopes fully independent`, () => {
      const id = `scopes/data:images/${type === 'file' ? 'a.png' : ''}`
      const refs = [
        parseRef(type, id), parseRef(type, id, { kind: 'branch', id: 'main' }),
        parseRef(type, id, { kind: 'branch', id: 'dev' }), parseRef(type, id, { kind: 'commit', id: 'abc' }),
      ]
      refs.forEach((ref, i) => putOwnRecord(ref, { labels: { scope: String(i) } }, actor))
      refs.forEach((ref, i) => assert.equal(resolveEffective(ref, getOwnRecord).effective.labels.scope.value, String(i)))
      deleteOwnRecord(refs[1], actor)
      assert.deepEqual(resolveEffective(refs[1], getOwnRecord).effective, { tags: [], labels: {} })
      assert.equal(resolveEffective(refs[0], getOwnRecord).effective.labels.scope.value, '0')
    })
  }

  it('does not collide scoped identities with valid filenames', () => {
    assert.notEqual(refKey(parseRef('file', 'scope/data:x?scope=branch&revision=main')), refKey(parseRef('file', 'scope/data:x', { kind: 'branch', id: 'main' })))
  })

  it('rejects invalid refs and noncanonical paths', () => {
    for (const [type, id] of [['widget', 'x'], ['file', 'acme/data:../a'], ['directory', 'acme/data:images'], ['file', 'acme/data:a/']]) {
      assert.throws(() => parseRef(type, id), MetaError)
    }
    assert.throws(() => parseRef('repo', 'acme/data', { kind: 'branch', id: 'main' }), MetaError)
  })
})

describe('storage and concurrency', () => {
  const ref = parseRef('repo', 'store/data')
  it('validates inputs, limits, and removed inheritance options', () => {
    for (const patch of [
      { tags: ['Bad Tag'] }, { labels: { 'bad key': 'x' } }, { labels: { valid: 42 } },
      { tags: Array.from({ length: 51 }, (_, i) => `tag${i}`) },
      { labels: { valid: 'x'.repeat(2049) } }, { inherit: false },
      { propagation: {} }, { removeTags: ['old'] }, { unset: { labels: ['old'] } },
    ]) assert.throws(() => putOwnRecord(ref, JSON.parse(JSON.stringify(patch)), actor), MetaError)
  })
  it('preserves unrelated labels and physically removes keys', () => {
    putOwnRecord(ref, { tags: ['one'], labels: { first: '1', second: '2' } }, actor)
    putOwnRecord(ref, { tags: [], labels: { first: null, third: '' } }, actor)
    assert.deepEqual(getOwnRecord(ref)?.labels, { second: '2', third: '' })
    assert.deepEqual(getOwnRecord(ref)?.tags, [])
  })
  it('rejects stale writes and deletes, keeping revisions monotonic', () => {
    const revision = getRevision(ref)
    putOwnRecord(ref, { labels: { current: 'yes' } }, actor, revision)
    assert.throws(() => putOwnRecord(ref, { tags: ['stale'] }, actor, revision), /Revision conflict/)
    assert.throws(() => deleteOwnRecord(ref, actor, revision), /Revision conflict/)
    deleteOwnRecord(ref, actor, revision + 1)
    putOwnRecord(ref, { tags: ['new'] }, actor, revision + 2)
    assert.equal(getRevision(ref), revision + 3)
  })
  it('drops empty records without losing history or revisions', () => {
    const ref = parseRef('repo', 'empty/data')
    putOwnRecord(ref, { tags: ['only'] }, actor)
    putOwnRecord(ref, { tags: [] }, actor)
    assert.equal(getOwnRecord(ref), null)
    assert.equal(getRevision(ref), 2)
    assert.equal(listHistory(ref)[0].op, 'delete')
  })
  it('persistently migrates legacy rules without copying inherited values', () => {
    const path = join(dataDir, 'meta.json')
    const file = JSON.parse(readFileSync(path, 'utf8'))
    const explicit = parseRef('repo', 'legacy/data')
    const absent = parseRef('file', 'legacy/data:a.png')
    const record = { ref: explicit, revision: 8, tags: ['kept'], labels: { owner: 'local' }, inherit: false, propagation: { 'tag:kept': { mode: 'all' } }, removeTags: ['old'], unset: { labels: ['gone'] }, createdAt: '2026-01-01', updatedAt: '2026-01-01', updatedBy: actor }
    file.records[refKey(explicit)] = record
    file.records[refKey(absent)] = { ...record, ref: absent, revision: 9, tags: [], labels: {} }
    writeFileSync(path, JSON.stringify(file))
    assert.deepEqual(getOwnRecord(explicit)?.tags, ['kept'])
    assert.equal(getOwnRecord(absent), null)
    const migrated = JSON.parse(readFileSync(path, 'utf8'))
    for (const field of ['inherit', 'propagation', 'removeTags', 'unset']) assert.equal(Object.hasOwn(migrated.records[refKey(explicit)], field), false)
    assert.equal(migrated.records[refKey(absent)], undefined)
    assert.equal(getRevision(absent), 9)
    assert.deepEqual(resolveEffective(absent, getOwnRecord).effective, { tags: [], labels: {} })
  })
  it('surfaces corrupt storage rather than replacing it', () => {
    const path = join(dataDir, 'meta.json')
    const original = readFileSync(path, 'utf8')
    try {
      writeFileSync(path, '{invalid')
      assert.throws(() => getOwnRecord(ref), SyntaxError)
      assert.equal(readFileSync(path, 'utf8'), '{invalid')
    } finally { writeFileSync(path, original) }
  })
})

describe('explicit metadata search', () => {
  const parent = parseRef('namespace', 'search')
  const child = parseRef('repo', 'search/data')
  it('matches only annotations on the exact resource', () => {
    putOwnRecord(parent, { tags: ['parent'], labels: { owner: 'parent' } }, actor)
    putOwnRecord(child, { tags: ['child'], labels: { owner: 'child' } }, actor)
    const ctx = { candidates: [parent, child, parseRef('file', 'search/data:a')], getOwn: getOwnRecord, canRead: () => true }
    assert.deepEqual(searchMeta({ tags: ['parent'] }, ctx).hits.map(h => h.ref.id), ['search'])
    assert.deepEqual(searchMeta({ labels: { owner: 'child' } }, ctx).hits.map(h => h.ref.id), ['search/data'])
    assert.equal(searchMeta({}, ctx).total, 2)
    assert.equal(searchMeta({}, { ...ctx, canRead: r => r.type !== 'namespace' }).total, 1)
  })
  it('supports scoped results, query syntax, facets, and pagination', () => {
    const ctx = { candidates: listOwnRecords().map(r => r.ref), getOwn: getOwnRecord, canRead: () => true }
    const first = searchMeta({ limit: 1 }, ctx)
    const second = searchMeta({ limit: 1, cursor: first.nextCursor ?? undefined }, ctx)
    assert.notEqual(refKey(first.hits[0].ref), refKey(second.hits[0].ref))
    assert.ok(first.facets.types.repo)
    assert.deepEqual(parseQuerySyntax('tag:child type:repo label.owner:child hello'), { text: 'hello', types: ['repo'], tags: ['child'], labels: { owner: 'child' } })
    assert.equal(searchMeta({ q: 'tag:child type:repo label.owner:child' }, ctx).total, 1)
    assert.ok(searchMeta({ types: ['file'] }, ctx).hits.some(h => h.ref.scope?.kind === 'commit'))
  })
})
