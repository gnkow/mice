import { test, expect, repoPath } from '../fixtures'
import { createBranch, putFile, uniqueId } from '../helpers/oxenApi'
import { regulatedMutationHeaders } from '../helpers/regulated'
import { mintSession } from '../helpers/session'

const AUTH_URL = process.env.AUTH_URL ?? 'http://localhost:8080'

/** Seed (or drop) an approver through the real BFF with a dev mutation signature. */
async function seedApprover(
  page: import('@playwright/test').Page,
  path: string,
  method: 'PUT' | 'DELETE',
  body: { sub: string; iss: string },
) {
  const res = await page.request.fetch(`${AUTH_URL}${path}`, {
    method,
    headers: await regulatedMutationHeaders(page.request, { method, path, body, category: 'privileged_settings' }),
    data: body,
  })
  expect(res.ok(), await res.text()).toBeTruthy()
}

const ceremonyRejection = {
  status: 400,
  contentType: 'application/json',
  body: JSON.stringify({
    error: 'A reason and electronic signature are required for this change',
    code: 'reason_required',
  }),
}

test.describe('AuthZ + GxP deep UI', () => {
  test.describe('approver seats (#86, #124)', () => {
    test('TC-GXP-86-01: namespace Owner lists approvers and sees real version history', async ({
      page,
      emptyRepo,
    }) => {
      const ns = emptyRepo.namespace
      const path = `/auth/namespaces/${encodeURIComponent(ns)}/approvers`
      await seedApprover(page, path, 'PUT', { sub: 'approver-a', iss: 'mice-e2e' })
      await seedApprover(page, path, 'PUT', { sub: 'approver-b', iss: 'mice-e2e' })
      await seedApprover(page, path, 'DELETE', { sub: 'approver-a', iss: 'mice-e2e' })

      await page.goto(`/n/${encodeURIComponent(ns)}/settings`)
      const section = page.getByTestId('approvers-section')
      await expect(section.getByRole('heading', { name: 'Approvers' })).toBeVisible()
      await expect(section.getByTestId('approver-row')).toHaveCount(1)
      await expect(section.getByTestId('approver-row')).toContainText('approver-b')
      await expect(section.getByLabel('Search directory')).toBeVisible()
      await section.getByRole('button', { name: 'Manual entry' }).click()
      await expect(section.getByLabel('Subject (sub)')).toBeVisible()
      await expect(section.getByLabel('Issuer (iss)')).toBeVisible()

      await section.getByRole('button', { name: 'Approver history' }).click()
      const history = section.getByTestId('approver-history')
      await expect(history.getByTestId('history-version')).toHaveCount(3)
      await expect(history.getByTestId('history-version').last()).toContainText('current')
      await expect(history.getByTestId('history-version').last()).toContainText('approver-b')
      await expect(history.getByTestId('history-version').first()).toContainText('approver-a')
    })

    test('TC-GXP-86-02: assigning and revoking an approver sends labeled sub/iss; errors are role=alert', async ({
      page,
      emptyRepo,
    }) => {
      const ns = emptyRepo.namespace
      const seen: Array<{ method: string; body: unknown }> = []
      let deny = true
      await page.route(`**/auth/namespaces/${encodeURIComponent(ns)}/approvers`, async (route) => {
        const method = route.request().method()
        if (method === 'GET') return route.fallback()
        seen.push({ method, body: route.request().postDataJSON() })
        if (deny) {
          return route.fulfill({
            status: 403,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Only a namespace Owner can manage approvers' }),
          })
        }
        return route.fulfill({ json: { ok: true, approvers: [] } })
      })

      await page.goto(`/n/${encodeURIComponent(ns)}/settings`)
      const section = page.getByTestId('approvers-section')
      await section.getByRole('button', { name: 'Manual entry' }).click()
      await section.getByLabel('Subject (sub)').fill('qa-lead')
      await section.getByLabel('Issuer (iss)').fill('mice-e2e')
      await section.getByRole('button', { name: 'Assign approver' }).click()
      await expect(section.getByRole('alert')).toContainText('Only a namespace Owner')

      deny = false
      await section.getByRole('button', { name: 'Assign approver' }).click()
      await expect(section.getByRole('status').filter({ hasText: 'Assigned approver role to qa-lead' })).toBeVisible()
      expect(seen.map((s) => s.method)).toEqual(['PUT', 'PUT'])
      expect(seen[1]!.body).toEqual({ sub: 'qa-lead', iss: 'mice-e2e' })
    })

    test('TC-GXP-86-03: repository settings show a repo-scoped approver section', async ({
      page,
      emptyRepo,
    }) => {
      const path = `/auth/namespaces/${encodeURIComponent(emptyRepo.namespace)}/repos/${encodeURIComponent(emptyRepo.repo)}/approvers`
      await seedApprover(page, path, 'PUT', { sub: 'repo-approver', iss: 'mice-e2e' })

      await page.goto(repoPath(emptyRepo, '/settings'))
      const section = page.getByTestId('approvers-section')
      await expect(section).toContainText('on this repository')
      await expect(section.getByTestId('approver-row')).toContainText('repo-approver')

      await section.getByRole('button', { name: 'Revoke approver repo-approver' }).click()
      // Real mutation without a ceremony submission is rejected → reason prompt opens.
      await expect(page.getByRole('dialog', { name: /Reason and signature required/i })).toBeVisible()
      await page.getByRole('button', { name: 'Cancel' }).click()
      await expect(section.getByRole('alert')).toBeVisible()
    })
  })

  test.describe('entity history (#108, #109, #110)', () => {
    test('TC-GXP-108-01: membership and custom-role history pages render versions and are linked from settings', async ({
      page,
      emptyRepo,
    }) => {
      const ns = encodeURIComponent(emptyRepo.namespace)
      await page.route(`**/auth/namespaces/${ns}/members/history`, (route) =>
        route.fulfill({
          json: {
            versions: [
              {
                validFrom: '2026-01-01T10:00:00.000Z',
                validTo: '2026-01-02T10:00:00.000Z',
                members: [{ kind: 'user', key: 'mice-e2e|owner-1', role: 'owner' }],
              },
              {
                validFrom: '2026-01-02T10:00:00.000Z',
                validTo: null,
                members: [
                  { kind: 'user', key: 'mice-e2e|owner-1', role: 'owner' },
                  { kind: 'group', key: 'mice-e2e|qa-group', role: 'member' },
                ],
              },
            ],
          },
        }),
      )
      await page.route(`**/auth/namespaces/${ns}/custom-roles/history`, (route) =>
        route.fulfill({
          json: {
            versions: [
              {
                validFrom: '2026-01-03T10:00:00.000Z',
                validTo: null,
                kind: 'repo',
                roleId: 'qa',
                definition: { id: 'qa', name: 'QA reviewer', base: 'read', permissions: ['merge'] },
              },
            ],
          },
        }),
      )

      await page.goto(`/n/${ns}/settings`)
      await page.getByRole('link', { name: 'Membership history' }).click()
      await expect(page).toHaveURL(/\/settings\/members\/history$/)
      await expect(page.getByRole('heading', { name: 'Membership history' })).toBeVisible()
      const versions = page.getByTestId('history-version')
      await expect(versions).toHaveCount(2)
      await expect(versions.last()).toContainText('current')
      await expect(versions.last()).toContainText('qa-group')

      await page.getByRole('link', { name: 'Custom roles history' }).click()
      await expect(page).toHaveURL(/\/settings\/custom-roles\/history$/)
      await expect(page.getByRole('heading', { name: 'Custom roles history' })).toBeVisible()
      await expect(page.getByTestId('history-version')).toContainText('QA reviewer')
    })

    test('TC-GXP-109-01: repository collaborator history is linked from repo settings', async ({
      page,
      emptyRepo,
    }) => {
      const ns = encodeURIComponent(emptyRepo.namespace)
      const repo = encodeURIComponent(emptyRepo.repo)
      await page.route(`**/auth/namespaces/${ns}/repos/${repo}/collaborators/history`, (route) =>
        route.fulfill({
          json: {
            versions: [
              {
                validFrom: '2026-02-01T10:00:00.000Z',
                validTo: null,
                collaborators: [{ kind: 'user', key: 'mice-e2e|outside-1', role: 'write' }],
              },
            ],
          },
        }),
      )
      await page.goto(repoPath(emptyRepo, '/settings'))
      await page.getByRole('link', { name: 'Collaborator history' }).click()
      await expect(page).toHaveURL(/\/settings\/collaborators\/history$/)
      await expect(page.getByRole('heading', { name: 'Collaborator history', level: 1 })).toBeVisible()
      await expect(page.getByTestId('history-version')).toContainText('outside-1')
    })

    test('TC-GXP-110-01: a failed history load is announced as role=alert', async ({ page, emptyRepo }) => {
      const ns = encodeURIComponent(emptyRepo.namespace)
      await page.route(`**/auth/namespaces/${ns}/members/history`, (route) =>
        route.fulfill({ status: 403, json: { error: 'Forbidden' } }),
      )
      await page.goto(`/n/${ns}/settings/members/history`)
      await expect(page.getByRole('alert')).toContainText('Forbidden')
    })
  })

  test.describe('signature revoke (#93)', () => {
    const signatureEvent = (id: string) => ({
      id: `evt-${id}`,
      seq: 1,
      ts: new Date().toISOString(),
      actor: { sub: 'signer', iss: 'mice-e2e', name: 'Sig Signer', email: 'signer@mice.local' },
      via: 'session',
      method: 'POST',
      path: '/auth/sign/execute',
      status: 200,
      action: 'esign.created',
      action_label: 'Electronic signature recorded',
      message: 'Electronic signature created: Approved',
      detail: { signatureId: id, meaning: 'Approved' },
    })

    test('TC-GXP-93-01: non-approver gets a clear not_approver alert', async ({ page }) => {
      await mintSession(page, { role: 'admin', sub: uniqueId('revoke-admin'), iss: 'mice-e2e' })
      await page.route('**/auth/audit?*', (route) =>
        route.fulfill({ json: { events: [signatureEvent('sig-93-a')], nextCursor: null } }),
      )
      await page.route('**/auth/signatures/sig-93-a/revoke', (route) =>
        route.fulfill({
          status: 403,
          json: { error: 'Approver role required', code: 'not_approver' },
        }),
      )
      await page.goto('/audit')
      const row = page.locator('.audit-table tbody tr').first()
      await row.getByRole('button', { name: 'Revoke signature' }).click()
      await expect(row.getByRole('alert')).toContainText(/not an approver/i)
      await expect(row.getByRole('alert')).toContainText(/namespace Owner/i)
    })

    test('TC-GXP-93-02: revoke collects a reason through the signing ceremony', async ({ page }) => {
      await mintSession(page, { role: 'admin', sub: uniqueId('revoke-admin'), iss: 'mice-e2e' })
      await page.route('**/auth/audit?*', (route) =>
        route.fulfill({ json: { events: [signatureEvent('sig-93-b')], nextCursor: null } }),
      )
      await page.route('**/auth/signatures/sig-93-b/revoke', (route) => route.fulfill(ceremonyRejection))
      await page.goto('/audit')
      await page.locator('.audit-table tbody tr').first().getByRole('button', { name: 'Revoke signature' }).click()
      const dialog = page.getByRole('dialog', { name: /Reason and signature required/i })
      await expect(dialog).toBeVisible()
      await expect(dialog).toContainText(/Revoke signature sig-93-b/)
      await expect(dialog.getByLabel('Reason')).toBeVisible()
    })

    test('TC-GXP-93-03: an esign.revoked event marks the signature Revoked and hides the button', async ({ page }) => {
      await mintSession(page, { role: 'admin', sub: uniqueId('revoke-admin'), iss: 'mice-e2e' })
      await page.route('**/auth/audit?*', (route) =>
        route.fulfill({
          json: {
            events: [
              {
                ...signatureEvent('sig-93-c'),
                id: 'evt-revoked',
                action: 'esign.revoked',
                action_label: 'Electronic signature revoked',
              },
              signatureEvent('sig-93-c'),
            ],
            nextCursor: null,
          },
        }),
      )
      await page.goto('/audit')
      await expect(page.getByTestId('signature-revoked-tag')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Revoke signature' })).toHaveCount(0)
    })
  })

  test.describe('QC Failed warnings (#94)', () => {
    test('TC-GXP-94-01: history, merge and branch views warn when commits are QC Failed', async ({
      page,
      seededRepo,
    }) => {
      await createBranch(seededRepo.namespace, seededRepo.repo, 'feature', 'main')
      await putFile(seededRepo.namespace, seededRepo.repo, 'feature', 'qc.txt', 'qc\n', 'qc failed commit')
      await page.route('**/auth/repos/*/*/commits/*/qc', (route) =>
        route.fulfill({ json: { commitId: 'x', status: 'failed' } }),
      )

      await page.goto(repoPath(seededRepo, '/commits?branch=feature'))
      const warning = page.getByTestId('qc-failed-warning')
      await expect(warning).toBeVisible()
      await expect(warning).toContainText(/QC Failed/)
      await expect(page.getByTestId('commit-qc-failed').first()).toBeVisible()
      await expect(page.getByTestId('commit-detail-qc-failed')).toBeVisible()

      await page.goto(repoPath(seededRepo, '/merge?base=main&head=feature'))
      await expect(page.getByTestId('qc-failed-warning')).toContainText(/commits to merge/, { timeout: 30_000 })

      await page.goto(repoPath(seededRepo, '/branches/feature'))
      await expect(page.getByTestId('qc-failed-warning')).toContainText(/branch feature/)
    })

    test('TC-GXP-94-02: no warning when commits have no QC failure', async ({ page, seededRepo }) => {
      await page.route('**/auth/repos/*/*/commits/*/qc', (route) =>
        route.fulfill({ json: { commitId: 'x', status: 'passed' } }),
      )
      await page.goto(repoPath(seededRepo, '/commits'))
      await expect(page.locator('.commit-row').first()).toBeVisible()
      await expect(page.getByTestId('qc-failed-warning')).toHaveCount(0)
    })
  })

  test.describe('signed-record report (#106)', () => {
    test('TC-GXP-106-01: repo settings downloads the PDF; failures are role=alert', async ({
      page,
      emptyRepo,
    }) => {
      let fail = false
      await page.route('**/auth/repos/*/*/signed-record-report*', (route) => {
        if (fail) {
          return route.fulfill({ status: 403, json: { error: 'Forbidden' } })
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/pdf',
          headers: { 'content-disposition': 'attachment; filename="signed-record.pdf"' },
          body: '%PDF-1.4 e2e',
        })
      })
      await page.goto(repoPath(emptyRepo, '/settings'))
      const button = page.getByRole('button', { name: /Download signed-record report/ })
      const [download] = await Promise.all([page.waitForEvent('download'), button.click()])
      expect(download.suggestedFilename()).toBe('signed-record.pdf')
      await expect(page.getByText('Downloaded signed-record.pdf.')).toBeVisible()

      fail = true
      await button.click()
      await expect(page.getByRole('alert').filter({ hasText: 'Forbidden' })).toBeVisible()
    })
  })

  test.describe('settings operator UI (#122, #101)', () => {
    test.beforeEach(async ({ page }) => {
      await mintSession(page, { role: 'admin', sub: uniqueId('gxp-admin'), iss: 'mice-e2e' })
    })

    test('TC-GXP-122-01: seal-key rotation runs the reason/signing ceremony; cancel surfaces role=alert', async ({
      page,
    }) => {
      await page.route('**/auth/admin/seal-keys/current', (route) =>
        route.fulfill({
          json: {
            key: {
              id: 'seal_e2e_current',
              validFrom: Math.floor(Date.now() / 1000),
              validUntil: null,
              revokedAt: null,
              rotationType: 'normal',
              createdAt: new Date().toISOString(),
              status: 'current',
              isCurrent: true,
            },
          },
        }),
      )
      await page.route('**/auth/admin/seal-keys', (route) =>
        route.request().method() === 'GET' ? route.fulfill({ json: { keys: [] } }) : route.fallback(),
      )
      await page.route('**/auth/admin/seal-keys/rotate', (route) => route.fulfill(ceremonyRejection))

      await page.goto('/settings')
      await page.getByRole('link', { name: 'Seal keys', exact: true }).click()
      const section = page.locator('#seal-key-rotation')
      await section.getByRole('button', { name: 'Perform Normal Rotation' }).click()
      const dialog = page.getByRole('dialog', { name: /Reason and signature required/i })
      await expect(dialog).toBeVisible()
      await expect(dialog).toContainText(/Rotate the session cookie seal key/)
      await dialog.getByRole('button', { name: 'Cancel' }).click()
      await expect(section.getByRole('alert')).toContainText(/reason and electronic signature/i)
    })

    test('TC-GXP-101-01: restore-test status and recording a pass', async ({ page }) => {
      let passed = false
      await page.route('**/auth/admin/restore-test', (route) =>
        route.fulfill({
          json: {
            restoreTest: passed
              ? { passed: true, passedAt: new Date().toISOString(), recordedBy: 'mice-e2e|operator' }
              : { passed: false },
          },
        }),
      )
      await page.route('**/auth/admin/restore-test/pass', (route) => {
        passed = true
        return route.fulfill({ json: { restoreTest: { passed: true } } })
      })

      await page.goto('/settings')
      await page.getByRole('link', { name: 'Restore test', exact: true }).click()
      const section = page.locator('#restore-test')
      await expect(section.getByText('Not passed yet')).toBeVisible()

      const record = section.getByRole('button', { name: 'Record restore test pass' })
      await expect(record).toBeEnabled()
      await record.click()
      await expect(
        section.getByRole('status').filter({ hasText: 'Restore test recorded as passed.' }),
      ).toBeVisible()
      await expect(section.getByText('Passed', { exact: true })).toBeVisible()
      await expect(section.getByText(/mice-e2e\|operator/)).toBeVisible()
      await expect(record).toBeDisabled()
    })

    test('TC-GXP-101-02: a failed record is announced as role=alert', async ({ page }) => {
      await page.route('**/auth/admin/restore-test', (route) => route.fulfill({ json: { restoreTest: { passed: false } } }))
      await page.route('**/auth/admin/restore-test/pass', (route) =>
        route.fulfill({ status: 403, json: { error: 'Instance admin required' } }),
      )
      await page.goto('/settings')
      await page.getByRole('link', { name: 'Restore test', exact: true }).click()
      const section = page.locator('#restore-test')
      await section.getByRole('button', { name: 'Record restore test pass' }).click()
      await expect(section.getByRole('alert')).toContainText('Instance admin required')
    })
  })
})
