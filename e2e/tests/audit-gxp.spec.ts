import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { expect } from '@playwright/test'
import { cleanTest as base } from '../fixtures'
import { uniqueId } from '../helpers/oxenApi'
import { mintSession } from '../helpers/session'

const AUTH_URL = process.env.AUTH_URL ?? 'http://localhost:8080'
const OXEN_URL = process.env.OXEN_URL ?? 'http://127.0.0.1:3001'
const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..')

const test = base

function compose(args: string[], opts: { input?: string } = {}): string {
  return execFileSync('docker', ['compose', ...args], { cwd: ROOT, encoding: 'utf8', timeout: 180_000, ...opts })
}

const dockerStack = (() => {
  try {
    return compose(['ps', '--status', 'running', '--services']).split('\n').includes('auth')
  } catch {
    return false
  }
})()

type Page = import('@playwright/test').Page

async function login(page: Page, label: string, email = `${uniqueId(label)}@mice.local`) {
  await mintSession(page, { name: label, email, sub: uniqueId(label), iss: 'mice-e2e' })
}

/** A context without the suite-wide X-Mice-Reason header, so the reason rule is what is tested. */
async function bareSession(browser: import('@playwright/test').Browser, label: string, email?: string) {
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-mice-reason': '' } })
  const page = await ctx.newPage()
  await login(page, label, email)
  return { ctx, page }
}

async function waitForReadyz(predicate: (status: number, body: any) => boolean, ms = 150_000) {
  const deadline = Date.now() + ms
  let last = ''
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${AUTH_URL}/readyz`)
      const body = await res.json().catch(() => ({}))
      last = `${res.status} ${JSON.stringify(body)}`
      if (predicate(res.status, body)) return body
    } catch (err) {
      last = String(err)
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  throw new Error(`readyz condition not met in ${ms}ms; last: ${last}`)
}

async function oxenHasRepo(ns: string, repo: string): Promise<boolean | 'unreachable'> {
  try {
    const res = await fetch(`${OXEN_URL}/api/repos/${ns}/${repo}`)
    return res.status === 200
  } catch {
    return 'unreachable'
  }
}

test.describe('audit GxP deny paths', () => {
  test('TC-AUDIT-GXP-01: a mutation without a usable reason is rejected before oxen', async ({ browser }) => {
    const { ctx, page } = await bareSession(browser, 'gxp-reason')
    try {
      const ns = uniqueId('gxp-reason-ns')
      const noReasonNs = await page.request.post(`${AUTH_URL}/auth/namespaces`, { data: { name: ns, basePermission: 'none' } })
      expect(noReasonNs.status()).toBe(400)
      expect(((await noReasonNs.json()) as { code?: string }).code).toBe('reason_required')
      expect((await page.request.get(`${AUTH_URL}/auth/namespaces/${ns}`)).status()).toBe(404)

      const created = await page.request.post(`${AUTH_URL}/auth/namespaces`, {
        data: { name: ns, basePermission: 'none' },
        headers: { 'x-mice-reason': 'E2E namespace for the reason rule' },
      })
      expect(created.ok()).toBeTruthy()

      const missing = await page.request.post(`${AUTH_URL}/api/repos`, { data: { namespace: ns, name: 'r-missing' } })
      expect(missing.status()).toBe(400)
      expect(((await missing.json()) as { status_message?: string }).status_message).toBe('reason_required')

      const tooShort = await page.request.post(`${AUTH_URL}/api/repos`, {
        data: { namespace: ns, name: 'r-short' },
        headers: { 'x-mice-reason': 'short' },
      })
      expect(tooShort.status()).toBe(400)
      expect(((await tooShort.json()) as { status_message?: string }).status_message).toBe('reason_too_short')

      for (const name of ['r-missing', 'r-short']) {
        expect(await oxenHasRepo(ns, name), `${name} must not exist upstream`).not.toBe(true)
      }

      const ok = await page.request.post(`${AUTH_URL}/api/repos`, {
        data: { namespace: ns, name: 'r-ok' },
        headers: { 'x-mice-reason': 'E2E repository with a stated reason' },
      })
      expect(ok.ok()).toBeTruthy()
    } finally {
      await ctx.close()
    }
  })

  test('TC-AUDIT-GXP-02: an unreachable audit ledger refuses the mutation with 503', async ({ page }) => {
    test.skip(!dockerStack, 'needs the compose stack and docker')
    test.setTimeout(300_000)
    await login(page, 'gxp-store')
    const ns = uniqueId('gxp-store-ns')
    expect(
      (await page.request.post(`${AUTH_URL}/auth/namespaces`, { data: { name: ns, basePermission: 'none' } })).ok(),
    ).toBeTruthy()

    // With the ledger down every audit append fails while the rest of the stack stays up.
    compose(['stop', 'immudb'])
    try {
      const refused = await page.request.post(`${AUTH_URL}/api/repos`, { data: { namespace: ns, name: 'never' } })
      expect(refused.status()).toBe(503)
      expect(await oxenHasRepo(ns, 'never')).not.toBe(true)
      expect((await fetch(`${AUTH_URL}/readyz`)).status).toBe(503)
    } finally {
      compose(['start', 'immudb'])
    }
    await waitForReadyz((status) => status === 200)
    const after = await page.request.get(`${AUTH_URL}/api/repos/${ns}/never`)
    expect(after.status()).toBe(404)
    const retry = await page.request.post(`${AUTH_URL}/api/repos`, { data: { namespace: ns, name: 'after' } })
    expect(retry.ok()).toBeTruthy()
    await waitForReadyz((status) => status === 200)
  })

  test('TC-AUDIT-GXP-03: the audit trail verifies against the ledger and exports an unsigned bundle', async ({ browser }) => {
    test.skip(!dockerStack, 'needs the compose stack and docker')
    const admin = await bareSession(browser, 'gxp-admin', 'mice@example.com')
    try {
      const ready = await waitForReadyz((status) => status === 200)
      expect(ready.audit.chain).toBe('ok')
      const bundle = await admin.page.request.get(`${AUTH_URL}/auth/audit/export.bundle`)
      if (bundle.ok()) {
        const body = (await bundle.json()) as { format?: string; signing?: unknown; verification?: { ok?: boolean } }
        expect(body.format).toBe('mice-audit-bundle/2')
        expect(body.signing).toBeUndefined()
        expect(body.verification?.ok).toBe(true)
      }
    } finally {
      await admin.ctx.close()
    }
  })

  test('TC-AUDIT-GXP-04: raw oxen is not published by the base compose file, only on the BFF network', async () => {
    test.skip(!dockerStack, 'needs docker')
    // The production file set is compose.yaml alone; compose.override.yaml is the dev-only convenience.
    const base = JSON.parse(compose(['-f', 'compose.yaml', 'config', '--format', 'json'])) as {
      services: Record<string, { ports?: unknown[]; networks?: Record<string, unknown> | string[] }>
    }
    const oxen = base.services['oxen-server']!
    expect(oxen.ports ?? []).toEqual([])
    expect(Object.keys(oxen.networks ?? {})).toEqual(['mice'])
    expect(Object.keys(base.services['auth']!.networks ?? {})).toContain('mice')
    const published = Object.entries(base.services)
      .filter(([, s]) => (s.ports ?? []).length > 0)
      .map(([name]) => name)
      .sort()
    expect(published).not.toContain('oxen-server')

    // Dev trade-off, pinned so it cannot grow: the override publishes only 3001 for e2e setup helpers.
    const dev = JSON.parse(compose(['config', '--format', 'json'])) as { services: Record<string, { ports?: Array<{ target: number }> }> }
    expect((dev.services['oxen-server']!.ports ?? []).map((p) => p.target)).toEqual([3001])
  })
})
