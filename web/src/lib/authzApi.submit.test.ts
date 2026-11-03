import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

describe('RBAC S32 submitAccessRequest payload', () => {
  it('posts message and requestedRole to /auth/access-requests', async () => {
    let seen: { url: string; body: unknown } | null = null
    globalThis.fetch = (async (input, init) => {
      seen = {
        url: String(input),
        body: JSON.parse(String(init?.body ?? '{}')),
      }
      return new Response(JSON.stringify({ ok: true, request: { id: 'r1' } }), { status: 200 })
    }) as typeof fetch

    const { submitAccessRequest } = await import('./authzApi')
    await submitAccessRequest({
      message: 'Need access for onboarding',
      requestedRole: 'user',
    })
    assert.ok(seen)
    assert.match(seen!.url, /\/auth\/access-requests$/)
    assert.deepEqual(seen!.body, {
      message: 'Need access for onboarding',
      requestedRole: 'user',
    })
  })
})
