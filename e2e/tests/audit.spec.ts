import { test as base, expect } from '@playwright/test'
import { uniqueId } from '../helpers/oxenApi'
import { mintSession } from '../helpers/session'

const BASE_URL = process.env.MICE_BASE_URL ?? 'http://localhost:5173'
const AUTH_URL = process.env.AUTH_URL ?? 'http://localhost:8080'

const test = base

async function sessionLogin(
  page: import('@playwright/test').Page,
  identity?: { name?: string; email?: string; sub?: string },
) {
  await mintSession(page, {
    name: identity?.name,
    email: identity?.email,
    sub: identity?.sub,
    iss: 'mice-e2e',
  })
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
      email: 'pat-audit@mice.local',
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
      email: 'audit-ui@mice.local',
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

  test.describe('filters, labels and export', () => {
    async function seed(page: import('@playwright/test').Page) {
      const ns = uniqueId('audit-f')
      const repo = 'repo'
      expect(
        (await page.request.post(`${AUTH_URL}/api/repos`, { data: { namespace: ns, name: repo } })).ok(),
      ).toBeTruthy()
      const put = await page.request.put(
        `${AUTH_URL}/api/repos/${ns}/${repo}/file/main/a.txt`,
        {
          multipart: {
            file: { name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('x\n') },
            message: 'seed',
          },
        },
      )
      expect(put.ok()).toBeTruthy()
      const workspaceId = crypto.randomUUID()
      const ws = await page.request.post(
        `${AUTH_URL}/api/repos/${ns}/${repo}/workspaces`,
        { data: { workspace_id: workspaceId, branch_name: 'main', name: 'audit-ws' } },
      )
      expect(ws.ok()).toBeTruthy()
      const job = await page.request.post(`${AUTH_URL}/auth/jobs`, {
        data: { namespace: ns, repo, source: 'main', image: 'alpine', command: ['echo', 'hi'] },
      })
      expect(job.ok()).toBeTruthy()
      const jobId = (await job.json()).job.id as string
      return { ns, repo, workspaceId, jobId }
    }

    test('TC-AUDIT-07: filters by workspace and job id via API', async ({ page }) => {
      await sessionLogin(page)
      const { ns, workspaceId, jobId } = await seed(page)
      const w = await countAuditEvents(page, { namespace: ns, workspace_id: workspaceId })
      expect(w.events.length).toBeGreaterThan(0)
      expect(w.events.every((e) => (e.detail as { workspace_id?: string })?.workspace_id === workspaceId)).toBeTruthy()
      const j = await countAuditEvents(page, { namespace: ns, job_id: jobId })
      expect(j.events.length).toBeGreaterThan(0)
      expect(j.events.map((e) => e.action)).toContain('job.submit')
      const none = await countAuditEvents(page, { namespace: ns, job_id: 'nope' })
      expect(none.total).toBe(0)
    })

    test('TC-AUDIT-08: facets endpoint lists resources and labelled actions', async ({ page }) => {
      await sessionLogin(page)
      const { workspaceId, jobId } = await seed(page)
      const res = await page.request.get(`${AUTH_URL}/auth/audit/facets`)
      expect(res.ok()).toBeTruthy()
      const f = await res.json()
      expect(f.workspaces.map((x: { id: string }) => x.id)).toContain(workspaceId)
      expect(f.jobs.map((x: { id: string }) => x.id)).toContain(jobId)
      expect(f.actions.find((a: { value: string }) => a.value === 'file.write')?.label).toBeTruthy()
    })

    test('TC-AUDIT-09: facets and export require auth', async ({ playwright }) => {
      const ctx = await playwright.request.newContext()
      expect((await ctx.get(`${AUTH_URL}/auth/audit/facets`)).status()).toBe(401)
      expect((await ctx.get(`${AUTH_URL}/auth/audit/export.csv`)).status()).toBe(401)
      await ctx.dispose()
    })

    test('TC-AUDIT-10: CSV export respects filters and is itself audited', async ({ page }) => {
      await sessionLogin(page)
      const { ns, jobId } = await seed(page)
      const res = await page.request.get(
        `${AUTH_URL}/auth/audit/export.csv?namespace=${ns}&job_id=${jobId}`,
      )
      expect(res.ok()).toBeTruthy()
      expect(res.headers()['content-type']).toContain('text/csv')
      expect(res.headers()['content-disposition']).toMatch(/attachment; filename="audit-\d{4}-\d{2}-\d{2}\.csv"/)
      const lines = (await res.text()).trim().split('\r\n')
      expect(lines[0]).toContain('timestamp,actor_name')
      expect(lines.length).toBeGreaterThan(1)
      for (const l of lines.slice(1)) {
        expect(l).toContain(ns)
        expect(l).toContain(jobId)
      }
      const { events } = await countAuditEvents(page, { action: 'audit.export' })
      expect(events.length).toBeGreaterThan(0)
    })

    test('TC-AUDIT-11: UI shows labels, populated dropdowns, filters and exports', async ({ page }) => {
      await sessionLogin(page)
      const { ns, workspaceId, jobId } = await seed(page)
      await page.goto('/audit')
      await page.getByLabel('Namespace').fill(ns)
      await expect(page.locator('select[name="job_id"]').locator(`option[value="${jobId}"]`)).toHaveCount(1, { timeout: 15_000 })
      await expect(page.locator('select[name="workspace_id"]').locator(`option[value="${workspaceId}"]`)).toHaveCount(1)
      await expect(page.locator('.audit-filters select[name="session_id"]')).toBeVisible()
      await expect(page.getByLabel('Action').locator('optgroup').first()).toBeAttached()

      await page.locator('select[name="job_id"]').selectOption(jobId)
      await page.getByRole('button', { name: 'Filter' }).click()
      await expect(page).toHaveURL(new RegExp(`job_id=${jobId}`))
      const rows = page.locator('.audit-table tbody tr')
      await expect(rows.first()).toBeVisible({ timeout: 15_000 })
      await expect(page.locator('.audit-table')).toContainText('job.submit')

      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: 'Export CSV' }).click(),
      ])
      expect(download.suggestedFilename()).toMatch(/^audit-.*\.csv$/)
    })
  })
})
