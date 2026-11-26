import '../../src/db/testSchema.js'
import assert from 'node:assert/strict'
import { after, afterEach, describe, it } from 'node:test'
import { isolatedAuth } from '../../src/packages/shared/lib/testSupport.js'

/**
 * Seam: open MR use-case QC Marked.
 * Catches: server-side merge-range resolve marks commits without client commitIds.
 * Misses: oxen listMergeCommits I/O (injected via setMergeRangeResolverForTests).
 */
const t = isolatedAuth({ AUTHZ_BOOTSTRAP_ADMINS: 'root@x.io' })
after(() => t.restore())

const { createNamespaceAuthz } = await import('../../src/packages/authz/lib/authzNamespaceStore.js')
const { ensureRepository } = await import('../../src/packages/authz/lib/repositoryStore.js')
const { preparePrincipal } = await import('../../src/packages/authz/lib/authz.js')
const { setRepoCollaborator } = await import('../../src/packages/authz/lib/authzCollaboratorStore.js')
const { setMergeRangeResolverForTests } = await import(
  '../../src/packages/merge/lib/mergeRequestOxen.js'
)
const { openMergeRequestUseCase } = await import(
  '../../src/packages/merge/lib/mergeRequestLifecycle.js'
)
const { getCommitQc } = await import('../../src/packages/merge/lib/commitQcStore.js')

const writer = t.person('writer')
await preparePrincipal(writer)
await t.grantRole(writer, 'manager')
assert.equal((await createNamespaceAuthz(writer, 'qc-ns', 'none')).ok, true)
const repo = await ensureRepository('qc-ns', 'assay')
assert.ok(repo)
await setRepoCollaborator('qc-ns', 'assay', writer, 'write')

afterEach(() => setMergeRangeResolverForTests(null))

describe('open MR QC Marked (server-side range)', () => {
  it('marks range commits QC Marked without client commitIds', async () => {
    setMergeRangeResolverForTests(async () => ({
      authors: ['alice'],
      commitIds: ['range-a', 'range-b'],
    }))

    const out = await openMergeRequestUseCase({
      user: writer,
      ns: 'qc-ns',
      repoName: 'assay',
      body: {
        sourceBranch: 'feature',
        targetBranch: 'main',
        expectedSourceHead: 'src-tip',
        expectedTargetHead: 'tgt-tip',
      },
      audit: async () => {},
    })
    assert.equal(out.status, 201, JSON.stringify(out.body))
    assert.equal(await getCommitQc(repo.id, 'range-a'), 'marked')
    assert.equal(await getCommitQc(repo.id, 'range-b'), 'marked')
  })

  it('falls back to client commitIds when range resolve is unavailable', async () => {
    setMergeRangeResolverForTests(async () => {
      throw new Error('oxen unavailable')
    })

    const out = await openMergeRequestUseCase({
      user: writer,
      ns: 'qc-ns',
      repoName: 'assay',
      body: {
        sourceBranch: 'fallback-feat',
        targetBranch: 'main',
        expectedSourceHead: 'fb-s',
        expectedTargetHead: 'fb-t',
        commitIds: ['client-only'],
      },
      audit: async () => {},
    })
    assert.equal(out.status, 201, JSON.stringify(out.body))
    assert.equal(await getCommitQc(repo.id, 'client-only'), 'marked')
  })
})
