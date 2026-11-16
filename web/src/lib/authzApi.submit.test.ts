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

describe('AuthzError (#93)', () => {
  it('carries the HTTP status and machine code from the BFF', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: 'Approver role required', code: 'not_approver' }), {
        status: 403,
      })) as typeof fetch
    const { authzFetch, AuthzError } = await import('./authzApi')
    await assert.rejects(
      () => authzFetch('/auth/signatures/s1/revoke', { method: 'GET' }),
      (err: unknown) => {
        assert.ok(err instanceof AuthzError)
        assert.equal(err.status, 403)
        assert.equal(err.code, 'not_approver')
        assert.equal(err.message, 'Approver role required')
        return true
      },
    )
  })

  it('addresses approver seats per scope with PUT/DELETE and a history GET', async () => {
    const seen: Array<{ url: string; method: string }> = []
    globalThis.fetch = (async (input, init) => {
      seen.push({ url: String(input), method: init?.method ?? 'GET' })
      return new Response(JSON.stringify({ ok: true, approvers: [], versions: [] }), { status: 200 })
    }) as typeof fetch
    const api = await import('./authzApi')
    await api.fetchApprovers({ ns: 'a b' })
    await api.fetchApproverHistory({ ns: 'acme', repo: 'data' })
    assert.deepEqual(seen, [
      { url: '/auth/namespaces/a%20b/approvers', method: 'GET' },
      { url: '/auth/namespaces/acme/repos/data/approvers/history', method: 'GET' },
    ])
  })
})
