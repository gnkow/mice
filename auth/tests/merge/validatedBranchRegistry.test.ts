import '../../src/db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { isolatedAuth } from '../../src/packages/shared/lib/testSupport.js'

/**
 * Seam: validated-branch registry (#116).
 * Catches: marking a non-default branch validates it for the tip-write gate;
 *          unmarked siblings stay writable; default is validated from create.
 * Misses: UI chrome.
 */
const iso = isolatedAuth()
after(() => iso.restore())

const { ensureRepository } = await import('../../src/packages/authz/lib/repositoryStore.js')
const { createNamespaceAuthz } = await import('../../src/packages/authz/lib/authzNamespaceStore.js')
const { preparePrincipal } = await import('../../src/packages/authz/lib/authz.js')
const {
  decideValidatedBranchWrite,
  isValidatedBranch,
  listValidatedBranches,
  markBranchValidated,
  ensureDefaultBranchValidated,
} = await import('../../src/packages/merge/index.js')

const owner = iso.person('vb-owner')
await preparePrincipal(owner)
await iso.grantRole(owner, 'manager')
assert.equal((await createNamespaceAuthz(owner, 'vb-ns', 'none')).ok, true)
const repo = await ensureRepository('vb-ns', 'study')
assert.ok(repo)

describe('validated-branch registry (#116)', () => {
  it('marks feature validated so file.write is refused while develop still allows', async () => {
    await ensureDefaultBranchValidated(repo.id, 'main')
    await markBranchValidated({
      repositoryId: repo.id,
      branch: 'feature',
      markedBy: `${owner.iss}|${owner.sub}`,
      reason: 'Promote feature to validated line for assay release',
      changeControlId: 'CC-2026-116',
    })

    const validated = await listValidatedBranches(repo.id)
    assert.ok(isValidatedBranch('main', validated))
    assert.ok(isValidatedBranch('feature', validated))
    assert.equal(isValidatedBranch('develop', validated), false)

    const refuseFeature = decideValidatedBranchWrite({
      action: 'file.write',
      branch: 'feature',
      validatedBranches: validated,
    })
    assert.equal(refuseFeature.allow, false)

    const allowDevelop = decideValidatedBranchWrite({
      action: 'file.write',
      branch: 'develop',
      validatedBranches: validated,
    })
    assert.equal(allowDevelop.allow, true)
  })
})
