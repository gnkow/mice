import { expect } from '@playwright/test'
import { cleanTest as base } from '../fixtures'
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
    await page.getByLabel('Namespace', { exact: true }).fill(ns)
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

    test('TC-AUDIT-11: UI shows labels, populated suggestions, filters and exports', async ({ page }) => {
      await sessionLogin(page)
      const { ns, workspaceId, jobId } = await seed(page)
      await page.goto('/audit')
      await page.getByLabel('Namespace', { exact: true }).fill(ns)
      await page.getByLabel('Job', { exact: true }).click()
      await expect(
        page.getByRole('listbox', { name: 'Job suggestions' }).getByRole('option', { name: new RegExp(jobId) }),
      ).toBeVisible({ timeout: 15_000 })
      await page.getByLabel('Stage', { exact: true }).click()
      await expect(
        page.getByRole('listbox', { name: 'Stage suggestions' }).getByRole('option', { name: new RegExp(workspaceId) }),
      ).toBeVisible()
      await expect(page.locator('.audit-filters input[name="session_id"]')).toBeVisible()
      await page.getByLabel('Action', { exact: true }).click()
      await expect(page.getByRole('listbox', { name: 'Action suggestions' }).getByRole('option').first()).toBeVisible()

      await page.getByLabel('Job', { exact: true }).fill(jobId)
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

  test.describe('deep-ui: export PDF, verify, change control, denial', () => {
    const mockedEvent = {
      id: 'deep-ui-1',
      seq: 1,
      ts: new Date().toISOString(),
      actor: { sub: 'deep-ui', iss: 'mice-e2e', name: 'Deep UI', email: 'deep-ui@mice.local' },
      via: 'session',
      method: 'POST',
      path: '/api/repos/ns/repo/file/main/a.csv',
      status: 200,
      action: 'file.write',
      action_label: 'File written',
      namespace: 'ns',
      repo: 'repo',
      resource_uri: 'repo:ns/repo',
      change_control_id: 'CC-2026-0042',
      dataset: { base: 'aaaaaaaaaaaaaaaa1111', head: 'bbbbbbbbbbbbbbbb2222' },
    }

    test('TC-AUDIT-12: Export PDF button downloads the PDF export (#131)', async ({ page }) => {
      await sessionLogin(page)
      await page.route('**/auth/audit/export.pdf*', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/pdf',
          headers: { 'Content-Disposition': 'attachment; filename="audit-2026-01-01.pdf"' },
          body: Buffer.from('%PDF-1.4\n%%EOF\n'),
        }),
      )
      await page.goto('/audit')
      await expect(page.getByRole('button', { name: 'Export PDF' })).toBeEnabled({ timeout: 15_000 })
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: 'Export PDF' }).click(),
      ])
      expect(download.suggestedFilename()).toBe('audit-2026-01-01.pdf')
    })

    test('TC-AUDIT-13: Export PDF failure surfaces a role=alert message (#131)', async ({ page }) => {
      await sessionLogin(page)
      await page.route('**/auth/audit/export.pdf*', (route) =>
        route.fulfill({ status: 503, json: { error: 'Audit export signing key is not configured' } }),
      )
      await page.goto('/audit')
      await page.getByRole('button', { name: 'Export PDF' }).click()
      await expect(page.getByRole('alert')).toContainText('signing key is not configured')
    })

    test('TC-AUDIT-14: table shows resource URI, change control and change base→head (#139, #138)', async ({ page }) => {
      await sessionLogin(page)
      await page.route('**/auth/audit?*', (route) =>
        route.fulfill({ json: { events: [mockedEvent], nextCursor: null } }),
      )
      await page.goto('/audit')
      await expect(page.getByRole('columnheader', { name: 'Resource' })).toBeVisible()
      await expect(page.getByRole('columnheader', { name: 'Change control' })).toBeVisible()
      await expect(page.getByRole('columnheader', { name: 'Change', exact: true })).toBeVisible()
      const row = page.locator('.audit-table tbody tr').first()
      await expect(row.getByTestId('audit-resource')).toHaveText('repo:ns/repo')
      await expect(row.getByTestId('audit-change-control')).toHaveText('CC-2026-0042')
      await expect(row.getByTestId('audit-change')).toContainText('aaaaaaaa…')
      await expect(row.getByTestId('audit-change')).toContainText('bbbbbbbb…')
    })

    test('TC-AUDIT-15: Verify chain shows tip, and a break as role=alert (#135)', async ({ page }) => {
      await sessionLogin(page)
      let broken = false
      await page.route('**/auth/audit/verify', (route) =>
        route.fulfill({
          json: broken
            ? { ok: false, events: 7, verifiedAt: new Date().toISOString(), firstBreak: { seq: 4, reason: 'hash mismatch' } }
            : { ok: true, events: 7, verifiedAt: new Date().toISOString(), tip: { txid: 7, root: 'cm9vdA==' } },
        }),
      )
      await page.goto('/audit')
      await page.getByRole('button', { name: 'Verify chain' }).click()
      await expect(page.getByTestId('audit-verify-txid')).toHaveText('7')
      await expect(page.getByTestId('audit-verify-root')).toHaveText('cm9vdA==')

      broken = true
      await page.getByRole('button', { name: 'Verify chain' }).click()
      await expect(page.getByRole('alert').filter({ hasText: 'hash mismatch' })).toBeVisible()
      await expect(page.getByTestId('audit-verify-ok')).toHaveCount(0)
    })

    test('TC-AUDIT-16: 403 on audit fetch renders a denied state, not "Failed to load" (#140)', async ({ page }) => {
      await sessionLogin(page)
      await page.route('**/auth/audit?*', (route) =>
        route.fulfill({ status: 403, json: { error: 'Missing permission view_audit' } }),
      )
      await page.goto('/audit')
      const denied = page.getByTestId('audit-denied')
      await expect(denied).toBeVisible({ timeout: 15_000 })
      await expect(denied).toContainText('Access denied')
      await expect(denied).toContainText('Missing permission view_audit')
      await expect(page.getByText(/Failed to load audit log/)).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Export PDF' })).toBeDisabled()
    })

    test('TC-AUDIT-17: Settings audit health shows chain tip and export public key (#132)', async ({ page }) => {
      await mintSession(page, { sub: uniqueId('audit-health-admin'), role: 'admin' })
      await page.route('**/auth/admin/audit-health/status', (route) =>
        route.fulfill({
          json: {
            readiness: { ok: true, store: 'ok', chain: 'ok' },
            chainTip: { txid: 42, root: 'dGlwLXJvb3Q=', verifiedAt: new Date().toISOString() },
            exportPublicKey: '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAtest\n-----END PUBLIC KEY-----\n',
            ha: { attested: true, detail: 'ok' },
            currentOutage: null,
            recentOutages: [],
          },
        }),
      )
      await page.goto('/settings')
      await expect(page.getByTestId('audit-chain-tip-txid')).toHaveText('42', { timeout: 15_000 })
      await expect(page.getByTestId('audit-chain-tip-root')).toHaveText('dGlwLXJvb3Q=')
      await expect(page.getByTestId('audit-export-public-key-pem')).toContainText('BEGIN PUBLIC KEY')
    })

    test('TC-AUDIT-18: unpaired Intent shows summary and No Outcome badge (#127)', async ({ page }) => {
      await sessionLogin(page)
      await page.route('**/auth/audit?*', (route) =>
        route.fulfill({
          json: {
            events: [
              {
                ...mockedEvent,
                id: 'orphan-intent-1',
                phase: 'intent',
                orphan: true,
                orphan_aged: true,
                status: 0,
                action: 'workspace.merge',
                action_label: 'Workspace merge',
                resource_uri: 'repo:ns/repo',
                change_control_id: undefined,
                dataset: undefined,
              },
            ],
            nextCursor: null,
            orphan_aging_sec: 900,
          },
        }),
      )
      await page.goto('/audit')
      const summary = page.getByTestId('audit-orphan-summary')
      await expect(summary).toBeVisible({ timeout: 15_000 })
      await expect(summary).toHaveAttribute('role', 'status')
      await expect(summary).toContainText('aged Intent')
      await expect(page.getByTestId('audit-orphan-intent')).toBeVisible()
      await expect(page.getByTestId('audit-orphan-badge')).toHaveText('Aged orphan')
      await expect(page.getByTestId('audit-orphans-filter')).toBeVisible()
    })
  })
})
