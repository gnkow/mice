import assert from 'node:assert/strict'
import { test } from 'node:test'
import { withReason } from './reason'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

test('sends once when the server accepts it', async () => {
  const seen: Array<string | undefined> = []
  const res = await withReason(async (r) => (seen.push(r), json(200, { ok: true })), () => 'unused')
  assert.equal(res.status, 200)
  assert.deepEqual(seen, [undefined])
})

test('asks for a reason on reason_required (BFF-native shape) and retries with it', async () => {
  const seen: Array<string | undefined> = []
  const res = await withReason(
    async (r) => (seen.push(r), r ? json(200, { ok: true }) : json(400, { error: 'need one', code: 'reason_required' })),
    (detail) => (assert.equal(detail, 'need one'), 'Quarterly access review'),
  )
  assert.equal(res.status, 200)
  assert.deepEqual(seen, [undefined, 'Quarterly access review'])
})

test('recognises the oxen-shaped rejection and gives up when the user cancels', async () => {
  let calls = 0
  const res = await withReason(
    async () => (calls++, json(400, { status_message: 'reason_too_short', error: { detail: 'too short' } })),
    () => null,
  )
  assert.equal(res.status, 400)
  assert.equal(calls, 1)
})

test('does not ask for unrelated 400s', async () => {
  let asked = false
  await withReason(async () => json(400, { error: 'bad' }), () => ((asked = true), 'x'))
  assert.equal(asked, false)
})
