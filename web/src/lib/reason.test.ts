import assert from 'node:assert/strict'
import { test } from 'node:test'
import { summarizeMutation, withReason } from './reason'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const submission = {
  reason: 'Quarterly access review',
  category: 'privileged_settings' as const,
  changeControlId: 'CC-2026-114',
}

test('sends once when the server accepts it', async () => {
  const seen: Array<typeof submission | undefined> = []
  const res = await withReason(async (r) => (seen.push(r), json(200, { ok: true })), {
    ask: async () => ({ ...submission, reason: 'unused' }),
  })
  assert.equal(res.status, 200)
  assert.deepEqual(seen, [undefined])
})

test('asks for a reason on reason_required and retries with category, text and change-control id', async () => {
  const seen: Array<typeof submission | undefined> = []
  const res = await withReason(
    async (r) =>
      (seen.push(r),
      r ? json(200, { ok: true }) : json(400, { error: 'need one', code: 'reason_required' })),
    {
      changeSummary: 'Update settings for namespace “acme”',
      ask: async (input) => {
        assert.equal(input.detail, 'need one')
        assert.equal(input.changeSummary, 'Update settings for namespace “acme”')
        return submission
      },
    },
  )
  assert.equal(res.status, 200)
  assert.deepEqual(seen, [undefined, submission])
})

test('asks again when the change-control id is missing', async () => {
  const seen: Array<typeof submission | undefined> = []
  const res = await withReason(
    async (r) =>
      (seen.push(r),
      r
        ? json(200, { ok: true })
        : json(400, { error: 'need cc', code: 'change_control_required' })),
    { ask: async () => submission },
  )
  assert.equal(res.status, 200)
  assert.deepEqual(seen, [undefined, submission])
})

test('recognises the oxen-shaped rejection and gives up when the user cancels', async () => {
  let calls = 0
  const res = await withReason(
    async () => (calls++, json(400, { status_message: 'reason_too_short', error: { detail: 'too short' } })),
    { ask: async () => null },
  )
  assert.equal(res.status, 400)
  assert.equal(calls, 1)
})

test('does not ask for unrelated 400s', async () => {
  let asked = false
  await withReason(async () => json(400, { error: 'bad' }), {
    ask: async () => ((asked = true), submission),
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
