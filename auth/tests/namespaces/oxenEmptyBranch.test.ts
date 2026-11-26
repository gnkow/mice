import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { ensureEmptyOxenBranch } from '../../src/packages/namespaces/lib/oxenEmptyBranch.js'

const originalFetch = globalThis.fetch
const actor = {
  iss: 'https://idp.example',
  sub: 'actor-1',
  email: 'actor@example.com',
  name: 'Actor',
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('ensureEmptyOxenBranch', () => {
  it('no-ops when the branch already exists', async () => {
    const calls: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      calls.push(url)
      assert.match(url, /\/branches$/)
      return new Response(
        JSON.stringify({
          branches: [{ name: 'main', commit_id: 'tip-already' }],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      )
    }) as typeof fetch

    assert.deepEqual(await ensureEmptyOxenBranch('ns', 'repo', 'main', actor), {
      ok: true,
    })
    assert.ok(calls.length >= 1)
  })

  it('creates via workspace init then deletes the workspace', async () => {
    const calls: Array<{ url: string; method: string }> = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = (init?.method ?? 'GET').toUpperCase()
      calls.push({ url, method })
      if (url.endsWith('/branches') && method === 'GET') {
        const alreadyCreated = calls.some(
          (c) => c.method === 'POST' && c.url.includes('/workspaces'),
        )
        return new Response(
          JSON.stringify({
            branches: alreadyCreated
              ? [{ name: 'feature', commit_id: 'tip-new' }]
              : [],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      if (url.endsWith('/workspaces') && method === 'POST') {
        return new Response(
          JSON.stringify({
            status: 'success',
            workspace: {
              commit: {
                id: 'tip-new',
                author: 'Oxen',
                email: 'oxen@oxen.ai',
                message: 'Initialized Repo',
              },
            },
          }),
          { status: 200 },
        )
      }
      if (method === 'DELETE' && url.includes('/workspaces/')) {
        return new Response(null, { status: 200 })
      }
      return new Response('unexpected', { status: 500 })
    }) as typeof fetch

    assert.deepEqual(await ensureEmptyOxenBranch('ns', 'repo', 'feature', actor), {
      ok: true,
    })
    assert.ok(calls.some((c) => c.method === 'POST' && c.url.endsWith('/workspaces')))
    assert.ok(calls.some((c) => c.method === 'DELETE' && c.url.includes('/workspaces/')))
  })

  it('rejects an empty branch name', async () => {
    assert.deepEqual(await ensureEmptyOxenBranch('ns', 'repo', '  ', actor), {
      ok: false,
      error: 'branch name required',
    })
  })

  it('rejects a missing actor email', async () => {
    assert.deepEqual(
      await ensureEmptyOxenBranch('ns', 'repo', 'main', {
        iss: 'https://idp',
        sub: 'x',
        email: '',
      }),
      { ok: false, error: 'actor identity required for empty-tip attribution' },
    )
  })
})
