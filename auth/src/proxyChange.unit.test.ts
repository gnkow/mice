import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { EMPTY_AUDIT_CHANGE, NoChangeError } from './auditChange.js'
import { proxyMutationChange, workspaceFilePathsFromPathname, workspaceIdFromAnswer } from './proxyChange.js'

describe('proxyMutationChange', () => {
  it('records nothing for an upstream refusal', () => {
    assert.deepEqual(
      proxyMutationChange({ action: 'file.write', upstreamOk: false, branch: 'main', base: 'a', head: 'b' }),
      EMPTY_AUDIT_CHANGE,
    )
  })

  it('records the branch head and the file hashes of a file write', () => {
    const change = proxyMutationChange({
      action: 'file.write',
      upstreamOk: true,
      branch: 'main',
      base: 'c1',
      head: 'c2',
      fileDeltas: [{ path: 'data/a.csv', before: 'h1', after: 'h2' }],
    })
    assert.deepEqual(change, {
      before: { 'head.main': 'c1', 'file.data/a.csv': 'h1' },
      after: { 'head.main': 'c2', 'file.data/a.csv': 'h2' },
    })
  })

  it('records a first commit on a new branch as null → head', () => {
    const change = proxyMutationChange({ action: 'branch.create', upstreamOk: true, branch: 'dev', head: 'c9' })
    assert.deepEqual(change, { before: { 'head.dev': null }, after: { 'head.dev': 'c9' } })
  })

  it('records a file delete as hash → null', () => {
    const change = proxyMutationChange({
      action: 'file.delete',
      upstreamOk: true,
      branch: 'main',
      base: 'c1',
      head: 'c2',
      fileDeltas: [{ path: 'a.csv', before: 'h1', after: null }],
    })
    assert.deepEqual(change.after, { 'head.main': 'c2', 'file.a.csv': null })
  })

  it('records a branch delete as head → null', () => {
    assert.deepEqual(
      proxyMutationChange({ action: 'branch.delete', upstreamOk: true, branch: 'old', base: 'c1' }),
      { before: { 'head.old': 'c1' }, after: { 'head.old': null } },
    )
  })

  it('refuses an answered mutation that left the head unchanged', () => {
    assert.throws(
      () => proxyMutationChange({ action: 'merge', upstreamOk: true, branch: 'main', base: 'c1', head: 'c1' }),
      NoChangeError,
    )
  })

  it('flags an unknown new head as unverified instead of refusing', () => {
    const change = proxyMutationChange({ action: 'file.write', upstreamOk: true, branch: 'main', base: 'c1' })
    assert.deepEqual(change, {
      before: { 'head.main': 'c1', head_verified: null },
      after: { 'head.main': null, head_verified: false },
    })
  })

  it('records repo create and delete as null ↔ record', () => {
    const create = proxyMutationChange({
      action: 'repo.create',
      upstreamOk: true,
      namespace: 'ns',
      repo: 'r',
      repositoryId: 'id-1',
    })
    assert.deepEqual(create, { before: null, after: { namespace: 'ns', repo: 'r', repository_id: 'id-1' } })
    const del = proxyMutationChange({
      action: 'repo.delete',
      upstreamOk: true,
      namespace: 'ns',
      repo: 'r',
      repositoryId: 'id-1',
    })
    assert.deepEqual(del, { before: { namespace: 'ns', repo: 'r', repository_id: 'id-1' }, after: null })
  })

  it('records workspace create/delete and leaves transport requests empty (commit.upload)', () => {
    assert.deepEqual(
      proxyMutationChange({ action: 'workspace.create', upstreamOk: true, namespace: 'ns', repo: 'r', workspaceId: 'w1' }).before,
      null,
    )
    assert.deepEqual(
      proxyMutationChange({ action: 'workspace.delete', upstreamOk: true, namespace: 'ns', repo: 'r', workspaceId: 'w1' }).after,
      null,
    )
    assert.deepEqual(proxyMutationChange({ action: 'commit.upload', upstreamOk: true }), EMPTY_AUDIT_CHANGE)
  })

  it('records a workspace file write from its hash deltas', () => {
    const change = proxyMutationChange({
      action: 'workspace.file.write',
      upstreamOk: true,
      workspaceId: 'w1',
      fileDeltas: [
        { path: 'a.csv', before: 'h1', after: 'h2' },
        { path: 'b.csv', before: null, after: 'h3' },
      ],
    })
    assert.deepEqual(change, {
      before: { 'file.a.csv': 'h1', 'file.b.csv': null },
      after: { 'file.a.csv': 'h2', 'file.b.csv': 'h3' },
    })
  })

  it('records a workspace file delete as hash → null', () => {
    const change = proxyMutationChange({
      action: 'workspace.file.delete',
      upstreamOk: true,
      fileDeltas: [{ path: 'a.csv', before: 'h1', after: null }],
    })
    assert.deepEqual(change, { before: { 'file.a.csv': 'h1' }, after: { 'file.a.csv': null } })
  })

  it('falls back to the targeted paths when no hash deltas could be read', () => {
    assert.deepEqual(
      proxyMutationChange({ action: 'workspace.file.write', upstreamOk: true, paths: ['d/a.csv'] }),
      { before: { 'file.d/a.csv': null }, after: { 'file.d/a.csv': 'unverified' } },
    )
    assert.deepEqual(
      proxyMutationChange({ action: 'workspace.file.delete', upstreamOk: true, paths: ['d/a.csv'] }),
      { before: { 'file.d/a.csv': 'unverified' }, after: { 'file.d/a.csv': null } },
    )
  })

  it('still records something when a staging answer names no file', () => {
    const change = proxyMutationChange({ action: 'workspace.file.write', upstreamOk: true, workspaceId: 'w1' })
    assert.deepEqual(change, {
      before: { 'workspace.w1.staged': null },
      after: { 'workspace.w1.staged': 'unverified' },
    })
  })

  it('records nothing for a refused workspace file request', () => {
    assert.deepEqual(proxyMutationChange({ action: 'workspace.file.delete', upstreamOk: false }), EMPTY_AUDIT_CHANGE)
  })

  it('records repo metadata when before and after were captured', () => {
    const change = proxyMutationChange({
      action: 'repo.metadata',
      upstreamOk: true,
      metadataBefore: { description: 'a', visibility: 'private' },
      metadataAfter: { description: 'b', visibility: 'private' },
    })
    assert.deepEqual(change, { before: { description: 'a' }, after: { description: 'b' } })
  })

  it('refuses a repo metadata request that changed nothing', () => {
    assert.throws(
      () =>
        proxyMutationChange({
          action: 'repo.metadata',
          upstreamOk: true,
          metadataBefore: { description: 'a' },
          metadataAfter: { description: 'a' },
        }),
      NoChangeError,
    )
  })

  it('refuses repo metadata when the state was not captured (no-op null→null)', () => {
    assert.throws(
      () => proxyMutationChange({ action: 'repo.metadata', upstreamOk: true }),
      NoChangeError,
    )
  })
})

describe('workspaceFilePathsFromPathname', () => {
  it('reads the staged path after /files or /changes', () => {
    assert.deepEqual(workspaceFilePathsFromPathname('/api/repos/ns/r/workspaces/w1/files/data/a%20b.csv'), ['data/a b.csv'])
    assert.deepEqual(workspaceFilePathsFromPathname('/api/repos/ns/r/workspaces/w1/changes/a.csv'), ['a.csv'])
  })

  it('returns nothing when the path names no file', () => {
    assert.deepEqual(workspaceFilePathsFromPathname('/api/repos/ns/r/workspaces/w1/files'), [])
    assert.deepEqual(workspaceFilePathsFromPathname('/api/repos/ns/r/workspaces/w1/commit/main'), [])
  })
})

describe('workspaceIdFromAnswer', () => {
  it('reads the id from the usual answer shapes', () => {
    assert.equal(workspaceIdFromAnswer('{"workspace_id":"w1"}'), 'w1')
    assert.equal(workspaceIdFromAnswer('{"workspace":{"id":"w2"}}'), 'w2')
    assert.equal(workspaceIdFromAnswer('not json'), undefined)
    assert.equal(workspaceIdFromAnswer(undefined), undefined)
  })
})
