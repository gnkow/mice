import assert from 'node:assert/strict'
import { afterEach, describe, it, mock } from 'node:test'
import {
  SIGNING_RESUME_KEY,
  ensureResumeSignedMutation,
  pageResumePath,
  resetSigningResumeForTests,
  stashPendingSignedMutation,
  takeCeremonyResumeDraft,
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
})
