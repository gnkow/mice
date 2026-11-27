import '../../src/db/testSchema.js'
import assert from 'node:assert/strict'
import { after, afterEach, describe, it } from 'node:test'
import { isolatedAuth } from '../../src/packages/shared/lib/testSupport.js'

/**
 * Seam: open MR must not write QC (ADR 0009 — no Marked).
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

describe('open MR does not write QC (ADR 0009)', () => {
  it('leaves range commits Unset even when range resolve returns ids', async () => {
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
    assert.equal(await getCommitQc(repo.id, 'range-a'), 'unset')
    assert.equal(await getCommitQc(repo.id, 'range-b'), 'unset')
  })
})
