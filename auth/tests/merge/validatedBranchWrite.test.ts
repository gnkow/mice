import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  VALIDATED_BRANCH_DIRECT_WRITE,
  branchTargetFromPath,
  decideValidatedBranchWrite,
} from '../../src/packages/merge/lib/validatedBranchWrite.js'

describe('decideValidatedBranchWrite', () => {
  it('blocks tip-changing writes to the validated default branch', () => {
    for (const action of [
      'file.write',
      'file.delete',
      'workspace.commit',
      'workspace.merge',
      'merge',
      'branch.delete',
      'branch.update',
    ]) {
      const d = decideValidatedBranchWrite({ action, branch: 'main' })
      assert.equal(d.allow, false)
      if (!d.allow) {
        assert.equal(d.reason, VALIDATED_BRANCH_DIRECT_WRITE)
        assert.equal(d.branch, 'main')
      }
    }
  })

  it('allows the same actions on non-validated branches', () => {
    const d = decideValidatedBranchWrite({
      action: 'workspace.commit',
      branch: 'feature',
    })
    assert.equal(d.allow, true)
  })

  it('allows staging / metadata actions even when a branch is named', () => {
    assert.equal(
      decideValidatedBranchWrite({ action: 'workspace.file.write', branch: 'main' }).allow,
      true,
    )
    assert.equal(
      decideValidatedBranchWrite({ action: 'repo.metadata', branch: 'main' }).allow,
      true,
    )
  })

  it('respects a non-main default validated branch', () => {
    const d = decideValidatedBranchWrite({
      action: 'merge',
      branch: 'release',
      defaultBranch: 'release',
    })
    assert.equal(d.allow, false)
  })
})

describe('branchTargetFromPath', () => {
  it('reads file, merge, workspace, and branch targets', () => {
    assert.equal(branchTargetFromPath('/api/repos/n/r/file/main/a.csv'), 'main')
    assert.equal(branchTargetFromPath('/api/repos/n/r/merge/main..feature'), 'main')
    assert.equal(
      branchTargetFromPath('/api/repos/n/r/workspaces/w1/commit/main'),
      'main',
    )
    assert.equal(branchTargetFromPath('/api/repos/n/r/branches/main'), 'main')
  })
})
