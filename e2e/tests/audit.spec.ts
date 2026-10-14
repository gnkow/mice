import { test as base, expect } from '@playwright/test'
import { uniqueId } from '../helpers/oxenApi'

const BASE_URL = process.env.BOXEN_BASE_URL ?? 'http://localhost:5173'
const AUTH_URL = process.env.AUTH_URL ?? 'http://localhost:8080'

const test = base

async function sessionLogin(
  page: import('@playwright/test').Page,
  identity?: { name?: string; email?: string; sub?: string },
) {
  const res = await page.request.post(`${BASE_URL}/auth/dev-login`, {
    data: {
      name: identity?.name ?? 'Audit User',
      email: identity?.email ?? 'audit@boxen.local',
      sub: identity?.sub ?? 'audit-user',
      iss: 'boxen-dev',
    },
  })
  expect(res.ok()).toBeTruthy()
}

async function countAuditEvents(
  page: import('@playwright/test').Page,
  query: Record<string, string> = {},
): Promise<{ total: number; events: Array<Record<string, unknown>> }> {
  const params = new URLSearchParams({ limit: '100', ...query })
  const res = await page.request.get(
    `${AUTH_URL}/auth/audit?${params.toString()}`,
  )
  expect(res.ok()).toBeTruthy()
  const body = await res.json()
  return { total: body.events.length, events: body.events }
}

test.describe('audit log (PLAT-AUDIT)', () => {
  test('TC-AUDIT-01: session write via BFF creates attributable audit row', async ({
    page,
  }) => {
    const authorName = 'Audit Session Author'
    const authorEmail = 'audit-session@author.test'
    const sub = uniqueId('audit-sub')
    await sessionLogin(page, {
      name: authorName,
      email: authorEmail,
      sub,
    })

    const ns = uniqueId('audit-ns')
    const repo = 'repo'
    const create = await page.request.post(`${AUTH_URL}/api/repos`, {
      data: { namespace: ns, name: repo },
    })
    expect(create.ok()).toBeTruthy()

    const put = await page.request.put(
      `${AUTH_URL}/api/repos/${encodeURIComponent(ns)}/${encodeURIComponent(repo)}/file/main/readme.txt`,
      {
        multipart: {
          file: {
            name: 'readme.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from('audit seed\n'),
          },
          message: 'audit session commit',
          name: 'Forged',
          email: 'forged@evil.test',
        },
      },
    )
    expect(put.ok()).toBeTruthy()

    const { events } = await countAuditEvents(page, { namespace: ns })
    const write = events.find(
      (e) =>
        e.action === 'file.write' &&
        (e.actor as { sub?: string })?.sub === sub,
    )
    expect(write).toBeTruthy()
    expect((write!.actor as { name: string }).name).toBe(authorName)
    expect((write!.actor as { email: string }).email).toBe(authorEmail)
    expect(write!.via).toBe('session')
    expect(write!.message).toBe('audit session commit')
  })

  test('TC-AUDIT-02: PAT write records via: pat', async ({ page }) => {
    await sessionLogin(page, {
      name: 'PAT Audit',
      email: 'pat-audit@boxen.local',
      sub: uniqueId('pat-audit'),
    })
    const created = await page.request.post(`${BASE_URL}/auth/tokens`, {
      data: { label: 'audit-pat' },
    })
    expect(created.ok()).toBeTruthy()
    const { token: pat } = await created.json()
    await page.context().clearCookies()

    const ns = uniqueId('audit-pat-ns')
    const create = await page.request.post(`${AUTH_URL}/api/repos`, {
      headers: { Authorization: `Bearer ${pat}` },
      data: { namespace: ns, name: 'repo' },
    })
    expect(create.ok()).toBeTruthy()

    // Re-login to query audit (session required)
    await sessionLogin(page)
    const { events } = await countAuditEvents(page, { namespace: ns })
    const row = events.find((e) => e.action === 'repo.create')
    expect(row).toBeTruthy()
    expect(row!.via).toBe('pat')
  })

  test('TC-AUDIT-03: GET /api does not create audit lines', async ({
    page,
  }) => {
    await sessionLogin(page)
    const before = await page.request.get(`${AUTH_URL}/auth/audit?limit=100`)
    const beforeBody = await before.json()
    const beforeIds = new Set(
      (beforeBody.events as Array<{ id: string }>).map((e) => e.id),
    )

    const version = await page.request.get(`${AUTH_URL}/api/version`)
    expect(version.ok()).toBeTruthy()

    const after = await page.request.get(`${AUTH_URL}/auth/audit?limit=100`)
    const afterBody = await after.json()
    const newEvents = (
      afterBody.events as Array<{ id: string; method: string }>
    ).filter((e) => !beforeIds.has(e.id))
    expect(newEvents.every((e) => e.method !== 'GET')).toBeTruthy()
    expect(newEvents.length).toBe(0)
  })

  test('TC-AUDIT-04: GET /auth/audit without session returns 401', async ({
    page,
  }) => {
    await page.context().clearCookies()
    const res = await page.request.get(`${AUTH_URL}/auth/audit`)
    expect(res.status()).toBe(401)
  })

  test('TC-AUDIT-05: UI /audit lists recent event after a mutation', async ({
    page,
  }) => {
    const sub = uniqueId('audit-ui')
    await sessionLogin(page, {
      name: 'Audit UI User',
      email: 'audit-ui@boxen.local',
      sub,
    })
    const ns = uniqueId('audit-ui-ns')
    const create = await page.request.post(`${AUTH_URL}/api/repos`, {
      data: { namespace: ns, name: 'repo' },
    })
    expect(create.ok()).toBeTruthy()

    await page.goto('/audit')
    await expect(page.getByRole('heading', { name: 'Audit' })).toBeVisible()
    await page.getByLabel('Namespace').fill(ns)
    await page.getByRole('button', { name: 'Filter' }).click()
    await expect(page.locator('.audit-table tbody tr').first()).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.locator('.audit-table')).toContainText(ns)
    await expect(page.locator('.audit-table')).toContainText('repo.create')
  })

  test('TC-AUDIT-06: filter by namespace returns only matching rows', async ({
    page,
  }) => {
    await sessionLogin(page)
    const nsA = uniqueId('audit-a')
    const nsB = uniqueId('audit-b')
    for (const ns of [nsA, nsB]) {
      const res = await page.request.post(`${AUTH_URL}/api/repos`, {
        data: { namespace: ns, name: 'repo' },
      })
      expect(res.ok()).toBeTruthy()
    }

    const { events } = await countAuditEvents(page, { namespace: nsA })
    expect(events.length).toBeGreaterThan(0)
    expect(events.every((e) => e.namespace === nsA)).toBeTruthy()
    expect(events.some((e) => e.namespace === nsB)).toBeFalsy()
  })
})
