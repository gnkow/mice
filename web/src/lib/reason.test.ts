import assert from 'node:assert/strict'
import { test } from 'node:test'
import { summarizeMutation, withReason, type ReasonSubmission } from './reason'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const submission: ReasonSubmission = {
  reason: 'Quarterly access review',
  category: 'privileged_settings',
  changeControlId: 'CC-20261118-testhash',
  signatureId: 'sig-test-1',
}

test('sends once when the server accepts it', async () => {
  const seen: Array<ReasonSubmission | undefined> = []
  const res = await withReason(async (r) => (seen.push(r), json(200, { ok: true })), {
    ask: async () => ({ ...submission, reason: 'unused' }),
    method: 'PATCH',
    path: '/auth/namespaces/acme',
  })
  assert.equal(res.status, 200)
  assert.deepEqual(seen, [undefined])
})

test('asks for ceremony on signature_required and retries with signature id', async () => {
  const seen: Array<ReasonSubmission | undefined> = []
  const res = await withReason(
    async (r) =>
      (seen.push(r),
      r ? json(200, { ok: true }) : json(400, { error: 'need sig', code: 'signature_required' })),
    {
      changeSummary: 'Update settings for namespace “acme”',
      method: 'PATCH',
      path: '/auth/namespaces/acme',
      body: { membersCanCreateRepos: false },
      ask: async (input) => {
        assert.equal(input.detail, 'need sig')
        assert.equal(input.changeSummary, 'Update settings for namespace “acme”')
        assert.equal(input.method, 'PATCH')
        assert.equal(input.path, '/auth/namespaces/acme')
        return submission
      },
    },
  )
  assert.equal(res.status, 200)
  assert.deepEqual(seen, [undefined, submission])
})

test('asks for ceremony on reason_required', async () => {
  const seen: Array<ReasonSubmission | undefined> = []
  const res = await withReason(
    async (r) =>
      (seen.push(r),
      r ? json(200, { ok: true }) : json(400, { error: 'need one', code: 'reason_required' })),
    {
      method: 'PATCH',
      path: '/auth/namespaces/acme',
      ask: async () => submission,
    },
  )
  assert.equal(res.status, 200)
  assert.deepEqual(seen, [undefined, submission])
})

test('throws CeremonyCancelled when the user dismisses the ceremony', async () => {
  let calls = 0
  await assert.rejects(
    () =>
      withReason(
        async () =>
          (calls++, json(400, { status_message: 'reason_too_short', error: { detail: 'too short' } })),
        { ask: async () => null, method: 'DELETE', path: '/api/repos/a/b' },
      ),
    (err: unknown) => {
      assert.equal((err as Error).name, 'CeremonyCancelled')
      return true
    },
  )
  assert.equal(calls, 1)
})

test('does not ask for unrelated 400s', async () => {
  let asked = false
  await withReason(async () => json(400, { error: 'bad' }), {
    ask: async () => ((asked = true), submission),
    method: 'PATCH',
    path: '/auth/namespaces/acme',
  })
  assert.equal(asked, false)
})

test('summarizeMutation describes common update and delete paths', () => {
  assert.equal(
    summarizeMutation('DELETE', '/api/repos/demo/sample/branches/old'),
    'Delete branch “old” in demo/sample',
  )
  assert.equal(
    summarizeMutation('PATCH', '/auth/namespaces/acme'),
    'Update settings for namespace “acme”',
  )
})
