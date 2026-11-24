import assert from 'node:assert/strict'
import { afterEach, describe, it, mock } from 'node:test'
import {
  MERGE_SIGN_RESUME_KEY,
  SIGNING_RESUME_KEY,
  ensureResumeSignedMutation,
  pageResumePath,
  resetSigningResumeForTests,
  stashMergeSignResume,
  stashPendingSignedMutation,
  takeCeremonyResumeDraft,
  takeMergeSignResume,
} from './signingResume'

afterEach(() => {
  resetSigningResumeForTests()
  mock.restoreAll()
})

describe('signing resume after MFA step-up', () => {
  it('includes hash in pageResumePath so Settings sections survive reauth', () => {
    assert.equal(
      pageResumePath({ pathname: '/settings', search: '', hash: '#access-requests' }),
      '/settings#access-requests',
    )
  })

  it('stashes a signed mutation and resumes once on matching path', async () => {
    stashPendingSignedMutation({
      path: '/settings#access-requests',
      method: 'POST',
      apiPath: '/auth/access-requests/req-1',
      body: { action: 'approve', expiresAt: 1 },
      changeSummary: 'Decide an access request',
      draftReason: 'Approved after directory check',
    })

    const fetchMock = mock.method(globalThis, 'fetch', async () => {
      return new Response(
        JSON.stringify({ code: 'signature_required', error: 'A signature is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )
    })

    // askReason opener is null in unit tests → withReason throws CeremonyCancelled.
    const first = ensureResumeSignedMutation('/settings#access-requests')
    const second = ensureResumeSignedMutation('/settings')
    assert.ok(first)
    assert.equal(second?.promise, first.promise)
    assert.equal(first.intent.apiPath, '/auth/access-requests/req-1')

    const draft = takeCeremonyResumeDraft()
    assert.deepEqual(draft, {
      reason: 'Approved after directory check',
    })
    assert.equal(takeCeremonyResumeDraft(), null)

    await assert.rejects(() => first.promise, (err: unknown) => {
      assert.equal((err as Error).name, 'CeremonyCancelled')
      return true
    })
    assert.equal(fetchMock.mock.callCount(), 1)
    assert.equal(sessionStorage.getItem(SIGNING_RESUME_KEY), null)
    assert.equal(ensureResumeSignedMutation('/settings'), null)
  })

  it('ignores resume when the browser path does not match', () => {
    stashPendingSignedMutation({
      path: '/settings#access-requests',
      method: 'POST',
      apiPath: '/auth/access-requests/req-1',
      body: { action: 'approve', expiresAt: 1 },
    })
    assert.equal(ensureResumeSignedMutation('/repositories'), null)
  })

  it('stashes and reopens a merge signing ceremony on the matching path', () => {
    stashMergeSignResume({
      path: '/n/demo/r/assay/merge-requests/mr-1',
      mergeRequestId: 'mr-1',
      draftReason: 'Approve assay feature into main for release',
      draftChangeControlId: 'CC-20261124-test',
    })
    assert.ok(sessionStorage.getItem(MERGE_SIGN_RESUME_KEY))
    const resume = takeMergeSignResume('/n/demo/r/assay/merge-requests/mr-1')
    assert.ok(resume)
    assert.equal(resume.kind, 'merge_sign')
    assert.equal(resume.mergeRequestId, 'mr-1')
    assert.equal(resume.draftReason, 'Approve assay feature into main for release')
    assert.equal(resume.draftChangeControlId, 'CC-20261124-test')
    assert.equal(sessionStorage.getItem(MERGE_SIGN_RESUME_KEY), null)
    assert.equal(takeMergeSignResume('/n/demo/r/assay/merge-requests/mr-1'), null)
  })

  it('ignores merge sign resume on a different page', () => {
    stashMergeSignResume({
      path: '/n/demo/r/assay/merge-requests/mr-1',
      mergeRequestId: 'mr-1',
      draftReason: 'Approve assay feature into main for release',
    })
    assert.equal(takeMergeSignResume('/n/demo/r/assay/merge-requests'), null)
  })
})
