import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  VALIDATED_BRANCH_DIRECT_WRITE,
  branchFromMutationBody,
  branchTargetFromPath,
  branchesMovedByPublish,
  decideValidatedBranchWrite,
  isTipChangingAction,
  resolveValidatedBranchSet,
} from '../../src/packages/merge/lib/validatedBranchWrite.js'
import { isValidatedBranch } from '../../src/packages/merge/lib/signedMergeComplete.js'

describe('isTipChangingAction', () => {
  it('includes commit.publish and commit.upload for the validated tip gate (#116)', () => {
    assert.equal(isTipChangingAction('commit.publish'), true)
    assert.equal(isTipChangingAction('commit.upload'), true)
  })
})

describe('isValidatedBranch / registry set', () => {
  it('treats only listed branches as validated', () => {
    const set = ['main', 'feature']
    assert.equal(isValidatedBranch('main', set), true)
    assert.equal(isValidatedBranch('feature', set), true)
    assert.equal(isValidatedBranch('develop', set), false)
  })
})

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
      'commit.publish',
      'commit.upload',
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

  it('refuses file.write on a marked branch while a sibling stays open', () => {
    const validated = resolveValidatedBranchSet({
      defaultBranch: 'main',
      markedBranches: ['feature'],
    })
    assert.deepEqual(validated.sort(), ['feature', 'main'])
    assert.equal(
      decideValidatedBranchWrite({
        action: 'file.write',
        branch: 'feature',
        validatedBranches: validated,
      }).allow,
      false,
    )
    assert.equal(
      decideValidatedBranchWrite({
        action: 'file.write',
        branch: 'develop',
        validatedBranches: validated,
      }).allow,
      true,
    )
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

  it('refuses publish when any resolved tip branch is validated', () => {
    const d = decideValidatedBranchWrite({
      action: 'commit.publish',
      branches: ['feature', 'main'],
      validatedBranches: ['main'],
    })
    assert.equal(d.allow, false)
    if (!d.allow) assert.equal(d.branch, 'main')
  })
})

describe('branchTargetFromPath / body / publish resolution', () => {
  it('reads file, merge, workspace, and branch targets', () => {
    assert.equal(branchTargetFromPath('/api/repos/n/r/file/main/a.csv'), 'main')
    assert.equal(branchTargetFromPath('/api/repos/n/r/merge/main..feature'), 'main')
    assert.equal(
      branchTargetFromPath('/api/repos/n/r/workspaces/w1/commit/main'),
      'main',
    )
    assert.equal(branchTargetFromPath('/api/repos/n/r/branches/main'), 'main')
  })

  it('reads branch from mutation body keys', () => {
    assert.equal(branchFromMutationBody({ branch: 'feature' }), 'feature')
    assert.equal(branchFromMutationBody({ branch_name: ' release ' }), 'release')
    assert.equal(branchFromMutationBody({ new_branch: 'b' }), 'b')
    assert.equal(branchFromMutationBody({}), undefined)
  })

  it('matches publish parents to live branch tips', () => {
    assert.deepEqual(
      branchesMovedByPublish({
        publishedCommit: 'c-new',
        parents: ['main-old'],
        branchTips: [
          { name: 'main', commit_id: 'main-old' },
          { name: 'feature', commit_id: 'feat-old' },
        ],
      }),
      ['main'],
    )
  })
})
