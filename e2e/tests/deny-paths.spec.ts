import { expect } from '@playwright/test'
import { cleanTest as base } from '../fixtures'
import { uniqueId } from '../helpers/oxenApi'
import { mintSession } from '../helpers/session'

const AUTH_URL = process.env.AUTH_URL ?? 'http://localhost:8080'

const test = base

const bearer = (token: string) => ({ authorization: `Bearer ${token}` })

async function sessionUser(page: import('@playwright/test').Page, label: string) {
  const sub = uniqueId(label)
  await mintSession(page, { name: label, email: `${sub}@mice.local`, sub, iss: 'mice-e2e' })
  return sub
}

test.describe('deny paths (fail closed)', () => {
  test('TC-DENY-01: a cross-origin mutating request with a session cookie is rejected and has no effect', async ({
    page,
  }) => {
    await sessionUser(page, 'deny-csrf')
    const ns = uniqueId('deny-csrf-ns')

    const evil = await page.request.post(`${AUTH_URL}/auth/namespaces`, {
      headers: { origin: 'https://evil.example' },
      data: { name: ns, basePermission: 'none' },
    })
    expect(evil.status()).toBe(403)
    const body = (await evil.json()) as { error?: { detail?: string } }
    expect(body.error?.detail).toMatch(/cross-site/i)

    const missing = await page.request.get(`${AUTH_URL}/auth/namespaces/${encodeURIComponent(ns)}`)
    expect(missing.status()).toBe(404)

    const sameSite = await page.request.post(`${AUTH_URL}/auth/namespaces`, {
      headers: { origin: AUTH_URL },
      data: { name: ns, basePermission: 'none' },
    })
    expect(sameSite.ok()).toBeTruthy()
  })

  test('TC-DENY-03: an invalid PAT is rejected', async ({ browser }) => {
    const bare = await browser.newContext()
    try {
      const res = await bare.request.get(`${AUTH_URL}/api/repos`, {
        headers: bearer('mice_pat_not-a-real-token'),
      })
      expect(res.status()).toBe(401)
    } finally {
      await bare.close()
    }
  })

  test('TC-DENY-04: unauthenticated /api requests are rejected with the proxy error shape', async ({ browser }) => {
    const bare = await browser.newContext()
    try {
      for (const [method, path] of [
        ['GET', '/api/repos'],
        ['POST', '/api/repos'],
        ['GET', '/api/repos/nobody/nothing/branches'],
      ] as const) {
        const res = await bare.request.fetch(`${AUTH_URL}${path}`, { method, data: method === 'POST' ? {} : undefined })
        expect(res.status(), `${method} ${path}`).toBe(401)
        const body = (await res.json()) as { status?: string; status_message?: string }
        expect(body.status).toBe('error')
        expect(body.status_message).toBe('unauthorized')
      }
    } finally {
      await bare.close()
    }
  })
})
