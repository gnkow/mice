import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

const dataDir = mkdtempSync(join(tmpdir(), 'boxen-lineage-'))

process.env.AUTH_DATA_DIR = dataDir
process.env.SESSION_SECRET = 'test-secret'
process.env.OXEN_UPSTREAM = 'http://127.0.0.1:3001'

const {
  appendLineage,
  buildExplicitFileOp,
  classifyFileLineageOp,
  deriveCopyHeuristic,
  deriveCopiesFromCommitDiff,
  deriveMoveHeuristic,
  deriveOpsFromPathHistory,
  inferCopyPairs,
  fileVersionKey,
  parseCommitIdFromJson,
  producerIndex,
  pruneDuplicateProducers,
  queryLineage,
  validateArity,
} = await import('./lineage.js')

const actor = {
  sub: 'u1',
  iss: 'test',
  email: 'u1@test.local',
  name: 'User One',
}

describe('lineage classify + arity', () => {
  it('classifies PUT as upload when no prior', () => {
    const c = classifyFileLineageOp(
      'PUT',
      '/api/repos/ns/r/file/main/docs/a.txt',
    )
    assert.equal(c.kind, 'upload')
    assert.equal(c.namespace, 'ns')
    assert.equal(c.repo, 'r')
    assert.equal(c.branch, 'main')
    assert.equal(c.path, 'docs/a.txt')
  })

  it('classifies PUT as edit when prior exists', () => {
    const c = classifyFileLineageOp(
      'PUT',
      '/api/repos/ns/r/file/main/docs/a.txt',
      { priorExists: true },
    )
    assert.equal(c.kind, 'edit')
    assert.equal(c.path, 'docs/a.txt')
  })

  it('classifies PATCH same-folder as rename', () => {
    const c = classifyFileLineageOp(
      'PATCH',
      '/api/repos/ns/r/file/main/docs/old.txt',
      { newPath: 'docs/new.txt' },
    )
    assert.equal(c.kind, 'rename')
    assert.equal(c.path, 'docs/old.txt')
    assert.equal(c.newPath, 'docs/new.txt')
  })

  it('classifies PATCH different-folder as move', () => {
    const c = classifyFileLineageOp(
      'PATCH',
      '/api/repos/ns/r/file/main/old.txt',
      { newPath: 'archive/old.txt' },
    )
    assert.equal(c.kind, 'move')
    assert.equal(c.path, 'old.txt')
    assert.equal(c.newPath, 'archive/old.txt')
  })

  it('classifies PUT with copy_from (same basename) as copy', () => {
    const c = classifyFileLineageOp(
      'PUT',
      '/api/repos/ns/r/file/main/archive/report.csv',
      { copyFrom: 'data/report.csv' },
    )
    assert.equal(c.kind, 'copy')
    assert.equal(c.path, 'data/report.csv')
    assert.equal(c.newPath, 'archive/report.csv')
  })

  it('ignores copy_from when basename differs', () => {
    const c = classifyFileLineageOp(
      'PUT',
      '/api/repos/ns/r/file/main/archive/other.csv',
      { copyFrom: 'data/report.csv' },
    )
    assert.equal(c.kind, 'upload')
  })

  it('classifies PUT with restore_from as restore', () => {
    const c = classifyFileLineageOp(
      'PUT',
      '/api/repos/ns/r/file/main/docs/readme.md',
      { restoreFrom: 'abc123def4567890' },
    )
    assert.equal(c.kind, 'restore')
    assert.equal(c.path, 'docs/readme.md')
  })

  it('explicit restore records even when same content hash was uploaded before', () => {
    const up = buildExplicitFileOp({
      kind: 'upload',
      namespace: 'rst-ns',
      repo: 'r',
      branch: 'main',
      path: 'note.txt',
      commitId: 'c-up',
      contentHash: 'hsame',
      actor,
      via: 'session',
    })
    assert.ok(up)

    const del = buildExplicitFileOp({
      kind: 'delete',
      namespace: 'rst-ns',
      repo: 'r',
      branch: 'main',
      path: 'note.txt',
      commitId: 'c-del',
      contentHash: 'hsame',
      priorContentHash: 'hsame',
      priorCommitId: 'c-up',
      actor,
      via: 'session',
    })
    assert.ok(del)

    const restored = buildExplicitFileOp({
      kind: 'restore',
      namespace: 'rst-ns',
      repo: 'r',
      branch: 'main',
      path: 'note.txt',
      commitId: 'c-rst',
      contentHash: 'hsame',
      priorContentHash: 'hsame',
      priorCommitId: 'c-up',
      actor,
      via: 'session',
    })
    assert.ok(restored)
    assert.equal(restored!.kind, 'restore')
    assert.notEqual(restored!.id, up!.id)
    assert.equal(restored!.inputs[0]?.commitId, 'c-up')
    assert.equal(restored!.outputs[0]?.commitId, 'c-rst')
  })

  it('classifies DELETE as delete', () => {
    const c = classifyFileLineageOp(
      'DELETE',
      '/api/repos/ns/r/file/main/gone.txt',
    )
    assert.equal(c.kind, 'delete')
    assert.equal(c.path, 'gone.txt')
  })

  it('validates arity rules', () => {
    assert.equal(validateArity('upload', [], [{ namespace: 'n', repo: 'r', path: 'a' }]), null)
    assert.match(
      validateArity('upload', [{ namespace: 'n', repo: 'r', path: 'a' }], [
        { namespace: 'n', repo: 'r', path: 'a' },
      ]) ?? '',
      /no inputs/,
    )
    assert.equal(
      validateArity(
        'move',
        [{ namespace: 'n', repo: 'r', path: 'a' }],
        [{ namespace: 'n', repo: 'r', path: 'b' }],
      ),
      null,
    )
    assert.match(
      validateArity('delete', [{ namespace: 'n', repo: 'r', path: 'a' }], [
        { namespace: 'n', repo: 'r', path: 'a' },
      ]) ?? '',
      /no outputs/,
    )
  })

  it('parses commit id from oxen JSON', () => {
    assert.equal(
      parseCommitIdFromJson({ commit: { id: 'abc123' } }),
      'abc123',
    )
    assert.equal(parseCommitIdFromJson({}), undefined)
  })
})

describe('lineage store + query', () => {
  before(() => {
    // isolate: each describe shares dataDir; ops accumulate — ok for graph tests
  })

  after(() => {
    rmSync(dataDir, { recursive: true, force: true })
  })

  it('appends explicit upload and queries by path', () => {
    const op = buildExplicitFileOp({
      kind: 'upload',
      namespace: 'trace-ns',
      repo: 'trace-repo',
      branch: 'main',
      path: 'readme.txt',
      commitId: 'c1',
      actor,
      via: 'session',
      contentHash: 'h1',
    })
    assert.ok(op)
    assert.equal(op!.source, 'explicit')
    assert.equal(op!.inputs.length, 0)
    assert.equal(op!.outputs[0]?.contentHash, 'h1')

    const { operations } = queryLineage({
      namespace: 'trace-ns',
      repo: 'trace-repo',
      path: 'readme.txt',
    })
    assert.ok(operations.some((o) => o.id === op!.id))
  })

  it('appends move with high confidence', () => {
    const op = buildExplicitFileOp({
      kind: 'move',
      namespace: 'trace-ns',
      repo: 'trace-repo',
      branch: 'main',
      path: 'a.txt',
      newPath: 'dir/a.txt',
      commitId: 'c-move',
      actor,
      via: 'session',
      contentHash: 'hm',
    })
    assert.ok(op)
    assert.equal(op!.kind, 'move')
    assert.equal(op!.confidence, 'high')
    assert.equal(op!.inputs[0]?.path, 'a.txt')
    assert.equal(op!.outputs[0]?.path, 'dir/a.txt')
  })

  it('appends rename with high confidence', () => {
    const op = buildExplicitFileOp({
      kind: 'rename',
      namespace: 'trace-ns',
      repo: 'trace-repo',
      branch: 'main',
      path: 'a.txt',
      newPath: 'b.txt',
      commitId: 'c-ren',
      actor,
      via: 'session',
      contentHash: 'hr',
    })
    assert.ok(op)
    assert.equal(op!.kind, 'rename')
    assert.equal(op!.inputs[0]?.path, 'a.txt')
    assert.equal(op!.outputs[0]?.path, 'b.txt')
  })

  it('appends explicit edit with prior → new version', () => {
    const op = buildExplicitFileOp({
      kind: 'edit',
      namespace: 'edit-ns',
      repo: 'r',
      branch: 'main',
      path: 'note.txt',
      commitId: 'e2',
      priorContentHash: 'h-old',
      priorCommitId: 'e1',
      contentHash: 'h-new',
      actor,
      via: 'session',
    })
    assert.ok(op)
    assert.equal(op!.kind, 'edit')
    assert.equal(op!.source, 'explicit')
    assert.equal(op!.inputs[0]?.contentHash, 'h-old')
    assert.equal(op!.outputs[0]?.contentHash, 'h-new')
    assert.equal(op!.inputs.length, 1)
    assert.equal(op!.outputs.length, 1)
  })

  it('rejects edit without prior version signal', () => {
    const op = buildExplicitFileOp({
      kind: 'edit',
      namespace: 'edit-ns',
      repo: 'r',
      path: 'note.txt',
      commitId: 'e2',
      contentHash: 'h-new',
      actor,
      via: 'session',
    })
    assert.equal(op, null)
  })

  it('derives upload+edit chain from path history', () => {
    const created = deriveOpsFromPathHistory('derive-ns', 'r', 'main', [
      { path: 'f.txt', contentHash: 'v1', commitId: 'd1', ts: '2020-01-01T00:00:00.000Z' },
      { path: 'f.txt', contentHash: 'v2', commitId: 'd2', ts: '2020-01-02T00:00:00.000Z' },
    ])
    assert.equal(created.length, 2)
    assert.equal(created[0]?.kind, 'upload')
    assert.equal(created[1]?.kind, 'edit')
    assert.equal(created[1]?.source, 'derived')

    const { operations } = queryLineage({
      namespace: 'derive-ns',
      repo: 'r',
      path: 'f.txt',
      direction: 'both',
    })
    assert.ok(operations.some((o) => o.kind === 'edit'))
  })

  it('rebuild from history is idempotent', () => {
    const versions = [
      { path: 'idem.txt', contentHash: 'a1', commitId: 'i1', ts: '2020-01-01T00:00:00.000Z' },
      { path: 'idem.txt', contentHash: 'a2', commitId: 'i2', ts: '2020-01-02T00:00:00.000Z' },
    ]
    const first = deriveOpsFromPathHistory('idem-ns', 'r', 'main', versions)
    assert.equal(first.length, 2)
    const second = deriveOpsFromPathHistory('idem-ns', 'r', 'main', versions)
    assert.equal(second.length, 0)

    const { operations } = queryLineage({
      namespace: 'idem-ns',
      repo: 'r',
      path: 'idem.txt',
      direction: 'both',
      limit: 100,
    })
    assert.equal(operations.length, 2)
    const producers = producerIndex(operations)
    assert.equal(
      producers.get(fileVersionKey('idem-ns', 'r', { path: 'idem.txt', contentHash: 'a1' }))
        ?.kind,
      'upload',
    )
    assert.equal(
      producers.get(fileVersionKey('idem-ns', 'r', { path: 'idem.txt', contentHash: 'a2' }))
        ?.kind,
      'edit',
    )
  })

  it('skips derived upload when explicit covers commit+path', () => {
    appendLineage({
      kind: 'upload',
      namespace: 'skip-ns',
      repo: 'r',
      inputs: [],
      outputs: [
        { namespace: 'skip-ns', repo: 'r', path: 'x.txt', contentHash: 'h', commitId: 's1' },
      ],
      commitId: 's1',
      source: 'explicit',
      confidence: 'high',
      actor,
      via: 'session',
    })
    const created = deriveOpsFromPathHistory('skip-ns', 'r', 'main', [
      { path: 'x.txt', contentHash: 'h', commitId: 's1' },
    ])
    assert.equal(created.length, 0)
  })

  it('explicit producer supersedes derived for the same version', () => {
    appendLineage({
      id: 'dup1',
      kind: 'upload',
      namespace: 'dup-ns',
      repo: 'r',
      inputs: [],
      outputs: [
        { namespace: 'dup-ns', repo: 'r', path: 'd.txt', contentHash: 'h1', commitId: 'c1' },
      ],
      commitId: 'c1',
      source: 'derived',
      confidence: 'high',
      ts: '2020-01-01T00:00:00.000Z',
    })
    appendLineage({
      id: 'dup2',
      kind: 'upload',
      namespace: 'dup-ns',
      repo: 'r',
      inputs: [],
      outputs: [
        { namespace: 'dup-ns', repo: 'r', path: 'd.txt', contentHash: 'h1', commitId: 'c1' },
      ],
      commitId: 'c1',
      source: 'explicit',
      confidence: 'high',
      actor,
      via: 'session',
      ts: '2020-01-02T00:00:00.000Z',
    })
    pruneDuplicateProducers('dup-ns', 'r', 'd.txt')
    const { operations } = queryLineage({
      namespace: 'dup-ns',
      repo: 'r',
      path: 'd.txt',
      limit: 20,
    })
    const uploads = operations.filter((o) => o.kind === 'upload')
    assert.equal(uploads.length, 1)
    assert.equal(uploads[0]?.source, 'explicit')
  })

  it('derive path-change heuristic is rename/move by folder and skips if explicit exists', () => {
    const renamed = deriveMoveHeuristic({
      namespace: 'mv-ns',
      repo: 'r',
      commitId: 'm1',
      oldPath: 'old.bin',
      newPath: 'new.bin',
      contentHash: 'same',
    })
    assert.ok(renamed)
    assert.equal(renamed!.kind, 'rename')
    assert.equal(renamed!.confidence, 'low')

    const moved = deriveMoveHeuristic({
      namespace: 'mv-ns',
      repo: 'r',
      commitId: 'm1b',
      oldPath: 'old.bin',
      newPath: 'dir/old.bin',
      contentHash: 'same2',
    })
    assert.ok(moved)
    assert.equal(moved!.kind, 'move')

    const explicit = buildExplicitFileOp({
      kind: 'move',
      namespace: 'mv-ns',
      repo: 'r',
      path: 'a',
      newPath: 'other/a',
      commitId: 'm2',
      actor,
      via: 'pat',
    })
    assert.ok(explicit)
    const skipped = deriveMoveHeuristic({
      namespace: 'mv-ns',
      repo: 'r',
      commitId: 'm2',
      oldPath: 'a',
      newPath: 'other/a',
    })
    // Returns the existing explicit producer — does not create a second move.
    assert.equal(skipped?.id, explicit!.id)
    assert.equal(skipped?.source, 'explicit')
  })

  it('inferCopyPairs: requires same basename; source must not be removed', () => {
    const basePathsByHash = new Map<string, string[]>([
      ['hcopy', ['data/report.csv', 'notes/other.csv']],
      ['horphan', ['gone.txt']],
    ])
    const pairs = inferCopyPairs({
      added: [
        { path: 'archive/report.csv', contentHash: 'hcopy' },
        { path: 'archive/renamed.csv', contentHash: 'hcopy' },
        { path: 'other/gone.txt', contentHash: 'horphan' },
      ],
      removedPaths: ['gone.txt'],
      basePathsByHash,
    })
    // Same basename → copy; different basename (renamed.csv) skipped;
    // removed source (gone.txt) skipped.
    assert.deepEqual(pairs, [
      {
        sourcePath: 'data/report.csv',
        newPath: 'archive/report.csv',
        contentHash: 'hcopy',
      },
    ])
  })

  it('deriveCopyHeuristic records copy; refuses rename-copy or removed source', () => {
    const copied = deriveCopyHeuristic({
      namespace: 'cp-ns',
      repo: 'r',
      commitId: 'c1',
      sourcePath: 'src/a.txt',
      newPath: 'dst/a.txt',
      contentHash: 'habc',
    })
    assert.ok(copied)
    assert.equal(copied!.kind, 'copy')
    assert.equal(copied!.confidence, 'low')
    assert.equal(copied!.inputs[0]?.path, 'src/a.txt')
    assert.equal(copied!.outputs[0]?.path, 'dst/a.txt')

    assert.equal(
      deriveCopyHeuristic({
        namespace: 'cp-ns',
        repo: 'r',
        commitId: 'c2',
        sourcePath: 'src/a.txt',
        newPath: 'dst/b.txt',
        contentHash: 'habc',
      }),
      null,
    )

    assert.equal(
      deriveCopyHeuristic({
        namespace: 'cp-ns',
        repo: 'r',
        commitId: 'c2b',
        sourcePath: 'src/a.txt',
        newPath: 'dst/a.txt',
        contentHash: 'habc',
        sourceRemoved: true,
      }),
      null,
    )

    const fromDiff = deriveCopiesFromCommitDiff({
      namespace: 'cp-ns',
      repo: 'r',
      commitId: 'c3',
      added: [{ path: 'mirror/a.txt', contentHash: 'habc' }],
      removedPaths: [],
      basePathsByHash: new Map([['habc', ['src/a.txt']]]),
    })
    assert.equal(fromDiff.length, 1)
    assert.equal(fromDiff[0]?.kind, 'copy')
    assert.equal(fromDiff[0]?.outputs[0]?.path, 'mirror/a.txt')
  })

  it('rejects invalid arity on append', () => {
    const bad = appendLineage({
      kind: 'delete',
      namespace: 'bad',
      repo: 'r',
      inputs: [],
      outputs: [],
      source: 'explicit',
      confidence: 'high',
    })
    assert.equal(bad, null)
  })

  it('queryLineage filters by kind, since/until, and paginates with cursor', () => {
    const ns = 'q-ns'
    const repo = 'r'
    const up = appendLineage({
      id: 'q-up',
      kind: 'upload',
      namespace: ns,
      repo,
      inputs: [],
      outputs: [{ namespace: ns, repo, path: 'p.txt', contentHash: 'h1', commitId: 'c1' }],
      commitId: 'c1',
      source: 'explicit',
      confidence: 'high',
      ts: '2020-01-01T00:00:00.000Z',
    })
    const ed = appendLineage({
      id: 'q-ed',
      kind: 'edit',
      namespace: ns,
      repo,
      inputs: [{ namespace: ns, repo, path: 'p.txt', contentHash: 'h1', commitId: 'c1' }],
      outputs: [{ namespace: ns, repo, path: 'p.txt', contentHash: 'h2', commitId: 'c2' }],
      commitId: 'c2',
      source: 'explicit',
      confidence: 'high',
      ts: '2020-01-02T00:00:00.000Z',
    })
    assert.ok(up && ed)

    const byKind = queryLineage({ namespace: ns, repo, path: 'p.txt', kind: 'edit' })
    assert.equal(byKind.operations.length, 1)
    assert.equal(byKind.operations[0]?.kind, 'edit')

    const since = queryLineage({
      namespace: ns,
      repo,
      path: 'p.txt',
      since: '2020-01-01T12:00:00.000Z',
      direction: 'both',
    })
    assert.ok(since.operations.every((o) => o.ts >= '2020-01-01T12:00:00.000Z'))

    const page1 = queryLineage({
      namespace: ns,
      repo,
      path: 'p.txt',
      direction: 'both',
      limit: 1,
    })
    assert.equal(page1.operations.length, 1)
    assert.ok(page1.nextCursor)
    const page2 = queryLineage({
      namespace: ns,
      repo,
      path: 'p.txt',
      direction: 'both',
      limit: 1,
      cursor: page1.nextCursor!,
    })
    assert.equal(page2.operations.length, 1)
    assert.notEqual(page2.operations[0]?.id, page1.operations[0]?.id)
  })

  it('queryLineage ancestors vs descendants walks the graph', () => {
    const ns = 'walk-ns'
    const repo = 'r'
    // a.txt --copy--> b.txt --edit--> b.txt'
    appendLineage({
      id: 'w-up',
      kind: 'upload',
      namespace: ns,
      repo,
      inputs: [],
      outputs: [{ namespace: ns, repo, path: 'a.txt', contentHash: 'ha', commitId: 'c1' }],
      commitId: 'c1',
      source: 'explicit',
      confidence: 'high',
      ts: '2020-01-01T00:00:00.000Z',
    })
    appendLineage({
      id: 'w-cp',
      kind: 'copy',
      namespace: ns,
      repo,
      inputs: [{ namespace: ns, repo, path: 'a.txt', contentHash: 'ha', commitId: 'c1' }],
      outputs: [{ namespace: ns, repo, path: 'b.txt', contentHash: 'ha', commitId: 'c2' }],
      commitId: 'c2',
      source: 'explicit',
      confidence: 'high',
      ts: '2020-01-02T00:00:00.000Z',
    })
    appendLineage({
      id: 'w-ed',
      kind: 'edit',
      namespace: ns,
      repo,
      inputs: [{ namespace: ns, repo, path: 'b.txt', contentHash: 'ha', commitId: 'c2' }],
      outputs: [{ namespace: ns, repo, path: 'b.txt', contentHash: 'hb', commitId: 'c3' }],
      commitId: 'c3',
      source: 'explicit',
      confidence: 'high',
      ts: '2020-01-03T00:00:00.000Z',
    })

    const ancestors = queryLineage({
      namespace: ns,
      repo,
      path: 'b.txt',
      direction: 'ancestors',
      depth: 10,
      limit: 50,
    })
    const ancestorKinds = new Set(ancestors.operations.map((o) => o.kind))
    assert.ok(ancestorKinds.has('copy') || ancestorKinds.has('edit'))
    assert.ok(ancestorKinds.has('upload') || ancestorKinds.has('copy'))

    const descendants = queryLineage({
      namespace: ns,
      repo,
      path: 'a.txt',
      direction: 'descendants',
      depth: 10,
      limit: 50,
    })
    assert.ok(descendants.operations.some((o) => o.kind === 'copy'))
  })

  it('buildExplicitFileOp records copy with source → dest', () => {
    const op = buildExplicitFileOp({
      kind: 'copy',
      namespace: 'exp-cp-ns',
      repo: 'r',
      branch: 'main',
      path: 'src/report.csv',
      newPath: 'dst/report.csv',
      commitId: 'cp1',
      contentHash: 'hcp',
      actor,
      via: 'session',
    })
    assert.ok(op)
    assert.equal(op!.kind, 'copy')
    assert.equal(op!.confidence, 'high')
    assert.equal(op!.inputs[0]?.path, 'src/report.csv')
    assert.equal(op!.outputs[0]?.path, 'dst/report.csv')
  })
})
