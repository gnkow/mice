import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  decideSignedMergeComplete,
  SIGNED_MERGE_REFUSALS,
} from '../../src/packages/merge/lib/signedMergeComplete.js'

const mr = {
  id: 'mr-1',
  status: 'open' as const,
  namespace: 'lab',
  repo: 'assay',
  sourceBranch: 'feature',
  targetBranch: 'main',
  expectedSourceHead: 'src',
  expectedTargetHead: 'tgt',
  openedBy: 'https://idp|requester',
}

const binding = {
  repo: 'lab/assay',
  sourceHead: 'src',
  targetHead: 'tgt',
  manifestDigest: 'deadbeef',
}

describe('decideSignedMergeComplete (gxp/05)', () => {
  it('allows an open MR when approver, heads, binding, and authors all match', () => {
    const d = decideSignedMergeComplete({
      mr,
      isApprover: true,
      isValidatedTarget: true,
      liveSourceHead: 'src',
      liveTargetHead: 'tgt',
      authors: ['https://idp|author'],
      signer: { iss: 'https://idp', sub: 'approver' },
      signature: {
        meaning: 'Approved',
        binding,
        changeControlId: 'CC-20261116-abc',
      },
      expectedManifestDigest: 'deadbeef',
    })
    assert.equal(d.ok, true)
  })

  it('refuses when the signer is not an approver', () => {
    const d = decideSignedMergeComplete({
      mr,
      isApprover: false,
      isValidatedTarget: true,
      liveSourceHead: 'src',
      liveTargetHead: 'tgt',
      authors: ['https://idp|author'],
      signer: { iss: 'https://idp', sub: 'writer' },
      signature: { meaning: 'Approved', binding, changeControlId: 'CC-1' },
      expectedManifestDigest: 'deadbeef',
    })
    assert.equal(d.ok, false)
    if (!d.ok) assert.equal(d.code, SIGNED_MERGE_REFUSALS.not_approver)
  })

  it('refuses self-merge when the signer authored a commit in range', () => {
    const d = decideSignedMergeComplete({
      mr,
      isApprover: true,
      isValidatedTarget: true,
      liveSourceHead: 'src',
      liveTargetHead: 'tgt',
      authors: ['https://idp|approver'],
      signer: { iss: 'https://idp', sub: 'approver' },
      signature: { meaning: 'Approved', binding, changeControlId: 'CC-1' },
      expectedManifestDigest: 'deadbeef',
    })
    assert.equal(d.ok, false)
    if (!d.ok) assert.equal(d.code, SIGNED_MERGE_REFUSALS.self_merge)
  })

  it('refuses when the Approver signer also opened the request', () => {
    const d = decideSignedMergeComplete({
      mr: { ...mr, openedBy: 'https://idp|approver' },
      isApprover: true,
      isValidatedTarget: true,
      liveSourceHead: 'src',
      liveTargetHead: 'tgt',
      authors: ['https://idp|author'],
      signer: { iss: 'https://idp', sub: 'approver' },
      signature: { meaning: 'Approved', binding, changeControlId: 'CC-1' },
      expectedManifestDigest: 'deadbeef',
    })
    assert.equal(d.ok, false)
    if (!d.ok) {
      assert.equal(d.code, SIGNED_MERGE_REFUSALS.self_merge)
      assert.match(d.detail, /opened this request/i)
    }
  })

  it('refuses when live heads moved away from the expected binding', () => {
    const d = decideSignedMergeComplete({
      mr,
      isApprover: true,
      isValidatedTarget: true,
      liveSourceHead: 'src',
      liveTargetHead: 'moved',
      authors: ['https://idp|author'],
      signer: { iss: 'https://idp', sub: 'approver' },
      signature: { meaning: 'Approved', binding, changeControlId: 'CC-1' },
      expectedManifestDigest: 'deadbeef',
    })
    assert.equal(d.ok, false)
    if (!d.ok) assert.equal(d.code, SIGNED_MERGE_REFUSALS.head_mismatch)
  })

  it('refuses when the signature binding digest does not match the merge manifest', () => {
    const d = decideSignedMergeComplete({
      mr,
      isApprover: true,
      isValidatedTarget: true,
      liveSourceHead: 'src',
      liveTargetHead: 'tgt',
      authors: ['https://idp|author'],
      signer: { iss: 'https://idp', sub: 'approver' },
      signature: { meaning: 'Approved', binding, changeControlId: 'CC-1' },
      expectedManifestDigest: 'otherdigest',
    })
    assert.equal(d.ok, false)
    if (!d.ok) assert.equal(d.code, SIGNED_MERGE_REFUSALS.binding_mismatch)
  })

  it('refuses when meaning is not Approved or change-control id is missing', () => {
    const badMeaning = decideSignedMergeComplete({
      mr,
      isApprover: true,
      isValidatedTarget: true,
      liveSourceHead: 'src',
      liveTargetHead: 'tgt',
      authors: ['https://idp|author'],
      signer: { iss: 'https://idp', sub: 'approver' },
      signature: { meaning: 'Reviewed', binding, changeControlId: 'CC-1' },
      expectedManifestDigest: 'deadbeef',
    })
    assert.equal(badMeaning.ok, false)
    if (!badMeaning.ok) assert.equal(badMeaning.code, SIGNED_MERGE_REFUSALS.meaning)

    const noCc = decideSignedMergeComplete({
      mr,
      isApprover: true,
      isValidatedTarget: true,
      liveSourceHead: 'src',
      liveTargetHead: 'tgt',
      authors: ['https://idp|author'],
      signer: { iss: 'https://idp', sub: 'approver' },
      signature: { meaning: 'Approved', binding },
      expectedManifestDigest: 'deadbeef',
    })
    assert.equal(noCc.ok, false)
    if (!noCc.ok) assert.equal(noCc.code, SIGNED_MERGE_REFUSALS.change_control)
  })
})
