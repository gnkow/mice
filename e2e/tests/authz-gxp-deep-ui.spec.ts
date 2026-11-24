import { test, expect, repoPath } from '../fixtures'
import { mockDirectorySearch, pickFromDirectory } from '../helpers/directory'
import { createBranch, listBranches, putFile, uniqueId } from '../helpers/oxenApi'
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
    headers: await regulatedMutationHeaders(page.request, { method, path, body }),
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
      await expect(section.getByRole('button', { name: 'Manual entry' })).toHaveCount(0)

      await page
        .getByRole('navigation', { name: 'Settings sections' })
        .getByRole('link', { name: 'Approver history' })
        .click()
      const history = page.getByTestId('approver-history')
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

      await mockDirectorySearch(page, [
        {
          kind: 'user',
          sub: 'qa-lead',
          iss: 'mice-e2e',
          name: 'QA Lead',
          email: 'qa-lead@example.com',
        },
      ])

      await page.goto(`/n/${encodeURIComponent(ns)}/settings`)
      const section = page.getByTestId('approvers-section')
      await pickFromDirectory(section, 'qa-lead', /QA Lead|qa-lead/)
      await section.getByRole('button', { name: 'Assign approver' }).click()
      await expect(section.getByRole('alert')).toContainText('Only a namespace Owner')

      deny = false
      await section.getByRole('button', { name: 'Assign approver' }).click()
      await expect(section.getByRole('status').filter({ hasText: 'Assigned approver role to qa-lead' })).toBeVisible()
      expect(seen.map((s) => s.method)).toEqual(['PUT', 'PUT'])
      expect(seen[1]!.body).toEqual({ kind: 'user', sub: 'qa-lead', iss: 'mice-e2e' })
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
    const ns = 'demo'
    const repo = 'sample'
    const settingsPath = `/n/${ns}/r/${repo}/settings`

    function mockRepoChrome(
      page: import('@playwright/test').Page,
      opts: { isApprover: boolean; signatures: unknown[] },
    ) {
      return Promise.all([
        page.route(`**/auth/namespaces/${ns}/repos/${repo}/permissions`, (route) =>
          route.fulfill({
            json: {
              permissions: {
                rename: false,
                transfer: false,
                manageCollaborators: false,
                manageApprovers: false,
                editMetadata: false,
                deleteRepository: false,
                viewSignedRecord: true,
                contentsWrite: true,
                isApprover: opts.isApprover,
              },
            },
          }),
        ),
        page.route(`**/auth/repos/${ns}/${repo}/signatures**`, (route) =>
          route.fulfill({ json: { signatures: opts.signatures } }),
        ),
        page.route(`**/auth/namespaces/${ns}/repos/${repo}`, (route) =>
          route.fulfill({
            json: {
              repository: { id: 'r1', namespace: ns, name: repo, description: '' },
            },
          }),
        ),
        page.route(`**/auth/namespaces/${ns}/repos/${repo}/collaborators**`, (route) =>
          route.fulfill({ json: { collaborators: [] } }),
        ),
        page.route(`**/auth/namespaces/${ns}/repos/${repo}/approvers**`, (route) =>
          route.fulfill({ json: { approvers: [] } }),
        ),
      ])
    }

    const signatureRow = (id: string, revoked = false) => ({
      id,
      meaning: 'Approved',
      signedAt: new Date().toISOString(),
      signer: { iss: 'mice-e2e', sub: 'signer', name: 'Sig Signer' },
      binding: {
        repo: `${ns}/${repo}`,
        sourceHead: 'aaaaaaaa',
        targetHead: 'bbbbbbbb',
        manifestDigest: 'cc'.repeat(32),
      },
      changeControlId: 'CC-93',
      revoked,
      revocationCount: revoked ? 1 : 0,
    })

    test('TC-GXP-93-01: non-approver does not see revoke on Settings → Signatures', async ({
      page,
    }) => {
      await mintSession(page, { role: 'user', sub: uniqueId('revoke-writer'), iss: 'mice-e2e' })
      await mockRepoChrome(page, {
        isApprover: false,
        signatures: [signatureRow('sig-93-a')],
      })
      await page.goto(settingsPath)
      await expect(page.getByRole('heading', { name: 'Signatures' })).toBeVisible()
      await expect(page.getByTestId('repo-signature-row')).toHaveCount(1)
      await expect(page.getByRole('button', { name: 'Revoke signature' })).toHaveCount(0)
    })

    test('TC-GXP-93-07: Signatures list is searchable and paginated', async ({ page }) => {
      const many = Array.from({ length: 7 }, (_, i) =>
        signatureRow(`sig-93-page-${i}`, i === 6),
      )
      await mintSession(page, { role: 'user', sub: uniqueId('revoke-page'), iss: 'mice-e2e' })
      await mockRepoChrome(page, { isApprover: true, signatures: many })
      await page.goto(settingsPath)
      const signatures = page.locator('#repo-signatures')
      await expect(page.getByRole('heading', { name: 'Signatures' })).toBeVisible()
      await signatures.scrollIntoViewIfNeeded()
      await expect(page.getByTestId('repo-signatures-search')).toBeVisible()
      await expect(page.getByTestId('repo-signature-row')).toHaveCount(5)
      await expect(page.getByRole('navigation', { name: 'Signatures pagination' })).toBeVisible()
      await page.getByRole('button', { name: 'Next' }).click()
      await expect(page.getByTestId('repo-signature-row')).toHaveCount(2)
      await page.getByTestId('repo-signatures-search').fill('sig-93-page-6')
      await expect(page.getByTestId('repo-signature-row')).toHaveCount(1)
      await expect(page.getByTestId('signature-revoked-tag')).toBeVisible()
    })

    test('TC-GXP-93-02: Approver revoke opens the signing ceremony', async ({ page }) => {
      await mintSession(page, { role: 'user', sub: uniqueId('revoke-approver'), iss: 'mice-e2e' })
      await mockRepoChrome(page, {
        isApprover: true,
        signatures: [signatureRow('sig-93-b')],
      })
      await page.route('**/auth/signatures/sig-93-b/revoke', (route) =>
        route.fulfill(ceremonyRejection),
      )
      await page.goto(settingsPath)
      await page.getByRole('button', { name: 'Revoke signature' }).click()
      await expect(page.getByTestId('signature-revoke-modal')).toBeVisible()
      await expect(page.getByRole('dialog', { name: 'Revoke signature' })).toBeVisible()
      await Promise.all([
        page.waitForResponse(
          (res) =>
            res.url().includes('/auth/signatures/sig-93-b/revoke') && res.status() === 400,
        ),
        page.getByTestId('signature-revoke-confirm').click(),
      ])
      const dialog = page.getByRole('dialog', { name: /Signature Required/i })
      await expect(dialog).toBeVisible()
      await expect(dialog).toContainText(/Revoke signature sig-93-b/)
      await expect(dialog.getByLabel('Reason')).toBeVisible()
    })

    test('TC-GXP-93-03: revoked signatures show Revoked and hide the button', async ({ page }) => {
      await mintSession(page, { role: 'user', sub: uniqueId('revoke-approver'), iss: 'mice-e2e' })
      await mockRepoChrome(page, {
        isApprover: true,
        signatures: [signatureRow('sig-93-c', true)],
      })
      await page.goto(settingsPath)
      await expect(page.getByTestId('signature-revoked-tag')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Revoke signature' })).toHaveCount(0)
    })

    test('TC-GXP-93-04: Auditor audit trail shows Revoked without a revoke control', async ({
      page,
    }) => {
      await mintSession(page, { role: 'auditor', sub: uniqueId('revoke-auditor'), iss: 'mice-e2e' })
      await page.route('**/auth/audit?*', (route) =>
        route.fulfill({
          json: {
            events: [
              {
                id: 'evt-revoked',
                seq: 2,
                ts: new Date().toISOString(),
                actor: { sub: 'approver', iss: 'mice-e2e', name: 'Approver', email: 'a@mice.local' },
                via: 'session',
                method: 'POST',
                path: '/auth/signatures/sig-93-d/revoke',
                status: 200,
                action: 'esign.revoked',
                action_label: 'Electronic signature revoked',
                message: 'Revoked signature',
                signature_id: 'sig-93-d',
                detail: { signatureId: 'sig-93-d' },
              },
              {
                id: 'evt-sig',
                seq: 1,
                ts: new Date().toISOString(),
                actor: { sub: 'approver', iss: 'mice-e2e', name: 'Approver', email: 'a@mice.local' },
                via: 'session',
                method: 'POST',
                path: '/auth/merge-requests/x/complete',
                status: 200,
                action: 'merge_request.complete',
                action_label: 'Merge request completed',
                message: 'Merged',
                signature_id: 'sig-93-d',
                detail: { signatureId: 'sig-93-d', meaning: 'Approved' },
              },
            ],
            nextCursor: null,
          },
        }),
      )
      await page.goto('/audit')
      await expect(page.getByTestId('signature-revoked-tag').first()).toBeVisible()
      await expect(page.getByRole('button', { name: 'Revoke signature' })).toHaveCount(0)
    })

    test('TC-GXP-93-05: Approver can revoke from Merged requests', async ({ page }) => {
      await mintSession(page, { role: 'user', sub: uniqueId('revoke-merged'), iss: 'mice-e2e' })
      await page.route(`**/auth/namespaces/${ns}/repos/${repo}/permissions`, (route) =>
        route.fulfill({
          json: {
            permissions: {
              rename: false,
              transfer: false,
              manageCollaborators: false,
              manageApprovers: false,
              editMetadata: false,
              deleteRepository: false,
              viewSignedRecord: true,
              contentsWrite: true,
              isApprover: true,
            },
          },
        }),
      )
      await page.route(`**/auth/repos/${ns}/${repo}/merge-requests**`, (route) => {
        if (route.request().method() !== 'GET') return route.continue()
        return route.fulfill({
          json: {
            mergeRequests: [
              {
                id: 'mr-merged-93',
                repositoryId: 'r1',
                namespace: ns,
                repo,
                sourceBranch: 'feature',
                targetBranch: 'main',
                expectedSourceHead: 'aaaaaaaa',
                expectedTargetHead: 'bbbbbbbb',
                title: 'Merged for revoke',
                description: '',
                status: 'merged',
                openedBy: 'author@mice-e2e',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                mergeCommitId: 'cccccccc',
                signatureId: 'sig-93-merged',
                signatureRevoked: false,
              },
            ],
          },
        })
      })
      await page.route('**/auth/signatures/sig-93-merged/revoke', (route) =>
        route.fulfill(ceremonyRejection),
      )
      await page.goto(`/n/${ns}/r/${repo}/merge-requests?status=merged`)
      await expect(page.getByTestId('mr-merged-revoke')).toBeVisible()
      await page.getByRole('button', { name: 'Revoke signature' }).click()
      await expect(page.getByTestId('signature-revoke-modal')).toBeVisible()
      await Promise.all([
        page.waitForResponse(
          (res) =>
            res.url().includes('/auth/signatures/sig-93-merged/revoke') &&
            res.status() === 400,
        ),
        page.getByTestId('signature-revoke-confirm').click(),
      ])
      await expect(page.getByRole('dialog', { name: /Signature Required/i })).toBeVisible()
    })

    test('TC-GXP-93-06: Approver can revoke a commit on validated-branch history', async ({
      page,
    }) => {
      const commitId = 'deadbeefcafebabe'
      const commit = {
        id: commitId,
        message: 'signed merge',
        author: 'Approver',
        email: 'a@mice.local',
        timestamp: new Date().toISOString(),
        parent_ids: [] as string[],
      }
      await mintSession(page, { role: 'user', sub: uniqueId('revoke-hist'), iss: 'mice-e2e' })
      await page.route(`**/auth/namespaces/${ns}/repos/${repo}/permissions`, (route) =>
        route.fulfill({
          json: {
            permissions: {
              rename: false,
              transfer: false,
              manageCollaborators: false,
              manageApprovers: false,
              editMetadata: false,
              deleteRepository: false,
              viewSignedRecord: true,
              contentsWrite: true,
              isApprover: true,
            },
          },
        }),
      )
      await page.route(
        `**/auth/repos/${ns}/${repo}/commits/${commitId}/covering-signature**`,
        (route) =>
          route.fulfill({
            json: { signature: { signatureId: 'sig-93-hist', revoked: false } },
          }),
      )
      await page.route('**/auth/signatures/sig-93-hist/revoke', (route) =>
        route.fulfill(ceremonyRejection),
      )
      await page.route(`**/api/repos/${ns}/${repo}/branches**`, (route) =>
        route.fulfill({
          json: { status: 'success', status_message: 'ok', branches: [{ name: 'main', commit_id: commitId }] },
        }),
      )
      await page.route(`**/api/repos/${ns}/${repo}/commits/history/**`, (route) =>
        route.fulfill({
          json: { status: 'success', status_message: 'ok', commits: [commit] },
        }),
      )
      await page.route(`**/api/repos/${ns}/${repo}/commits/${commitId}**`, (route) => {
        if (route.request().url().includes('/covering-signature')) return route.fallback()
        return route.fulfill({
          json: { status: 'success', status_message: 'ok', commit },
        })
      })
      await page.route(`**/auth/repos/${ns}/${repo}/commits/*/qc**`, (route) =>
        route.fulfill({ json: { commitId, status: 'passed' } }),
      )
      await page.goto(
        `/n/${ns}/r/${repo}/commits/${encodeURIComponent(commitId)}?branch=main`,
      )
      await expect(page.getByTestId('history-commit-revoke')).toBeVisible()
      await page.getByRole('button', { name: 'Revoke commit' }).click()
      await expect(page.getByTestId('signature-revoke-modal')).toBeVisible()
      await Promise.all([
        page.waitForResponse(
          (res) =>
            res.url().includes('/auth/signatures/sig-93-hist/revoke') &&
            res.status() === 400,
        ),
        page.getByTestId('signature-revoke-confirm').click(),
      ])
      await expect(page.getByRole('dialog', { name: /Signature Required/i })).toBeVisible()
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
      await expect(page.getByTestId('qc-failed-warning')).toContainText(/commits to merge/, {
        timeout: 30_000,
      })
      await expect(page.getByTestId('qc-failed-warning')).toContainText(/Review the revoked signature/)

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

    test('TC-GXP-94-03: merge request warns and blocks Approve when range has QC Failed', async ({
      page,
      seededRepo,
    }) => {
      // Default suite session (e2e-user) already has admin collaborator + opens the MR.
      const approver = uniqueId('gxp94-appr')
      await createBranch(seededRepo.namespace, seededRepo.repo, 'feature-94', 'main')
      await putFile(
        seededRepo.namespace,
        seededRepo.repo,
        'feature-94',
        'qc94.txt',
        'qc94\n',
        'qc failed for mr',
      )
      const branches = await listBranches(seededRepo.namespace, seededRepo.repo)
      const tip = (name: string) => {
        const id = branches.find((b) => b.name === name)?.commit_id
        expect(id, `${name} tip`).toBeTruthy()
        return id!
      }
      const createPath = `/auth/repos/${encodeURIComponent(seededRepo.namespace)}/${encodeURIComponent(seededRepo.repo)}/merge-requests`
      const createBody = {
        sourceBranch: 'feature-94',
        targetBranch: 'main',
        expectedSourceHead: tip('feature-94'),
        expectedTargetHead: tip('main'),
        title: 'QC Failed MR',
      }
      const createRes = await page.request.fetch(`${AUTH_URL}${createPath}`, {
        method: 'POST',
        headers: await regulatedMutationHeaders(page.request, {
          method: 'POST',
          path: createPath,
          body: createBody,
          reason: 'E2E: open MR for QC Failed warn coverage',
        }),
        data: createBody,
      })
      expect(createRes.ok(), await createRes.text()).toBeTruthy()
      const created = (await createRes.json()) as { mergeRequest: { id: string } }

      await seedApprover(
        page,
        `/auth/namespaces/${encodeURIComponent(seededRepo.namespace)}/repos/${encodeURIComponent(seededRepo.repo)}/approvers`,
        'PUT',
        { sub: approver, iss: 'mice-e2e' },
      )
      // Read seat so Approver can load the range; Approver≠opener avoids self-merge mask.
      const collabPath = `/auth/namespaces/${encodeURIComponent(seededRepo.namespace)}/repos/${encodeURIComponent(seededRepo.repo)}/collaborators`
      const collabBody = {
        kind: 'user' as const,
        sub: approver,
        iss: 'mice-e2e',
        role: 'read' as const,
      }
      const collabRes = await page.request.fetch(`${AUTH_URL}${collabPath}`, {
        method: 'PUT',
        headers: await regulatedMutationHeaders(page.request, {
          method: 'PUT',
          path: collabPath,
          body: collabBody,
          reason: 'E2E: grant Approver read for QC Failed MR warn',
        }),
        data: collabBody,
      })
      expect(collabRes.ok(), await collabRes.text()).toBeTruthy()
      await mintSession(page, { role: 'admin', sub: approver, iss: 'mice-e2e' })
      await page.route('**/auth/repos/*/*/commits/*/qc', (route) =>
        route.fulfill({ json: { commitId: 'x', status: 'failed' } }),
      )

      await page.goto(repoPath(seededRepo, `/merge-requests/${created.mergeRequest.id}`))
      const warning = page.getByTestId('qc-failed-warning')
      await expect(warning).toBeVisible({ timeout: 30_000 })
      await expect(warning).toContainText(/this request/)
      await expect(warning).toContainText(/Approve is blocked/)
      await expect(page.getByTestId('commit-qc-failed').first()).toBeVisible()
      const approve = page.getByRole('button', { name: 'Approve' })
      await expect(approve).toBeDisabled()
      await expect(approve).toHaveAttribute('title', /QC Failed commits in range/)
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
        const url = route.request().url()
        if (url.includes('format=json')) {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ report: { signatures: [] } }),
          })
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/pdf',
          headers: { 'content-disposition': 'attachment; filename="signed-record.pdf"' },
          body: '%PDF-1.4 e2e',
        })
      })
      await page.goto(repoPath(emptyRepo, '/settings'))
      await expect(page.getByRole('heading', { name: 'Signatures' })).toBeVisible()
      const section = page.locator('#repo-signatures').getByTestId('signed-record-report')
      const pdf = section.getByRole('button', { name: /^Download PDF$/ })
      const [download] = await Promise.all([page.waitForEvent('download'), pdf.click()])
      expect(download.suggestedFilename()).toBe('signed-record.pdf')

      fail = true
      await pdf.click()
      await expect(page.getByRole('alert').filter({ hasText: 'Forbidden' })).toBeVisible()
    })

    test('TC-GXP-106-02: Settings offers JSON download; History gates PDF on viewSignedRecord', async ({
      page,
      seededRepo,
    }) => {
      await page.route('**/auth/repos/*/*/signed-record-report*', (route) => {
        const url = route.request().url()
        if (url.includes('format=json')) {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ report: { signatures: [] } }),
          })
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/pdf',
          headers: { 'content-disposition': 'attachment; filename="signed-record.pdf"' },
          body: '%PDF-1.4 e2e',
        })
      })

      await page.goto(repoPath(seededRepo, '/settings'))
      const settings = page.locator('#repo-signatures').getByTestId('signed-record-report')
      const [jsonDownload] = await Promise.all([
        page.waitForEvent('download'),
        settings.getByRole('button', { name: /^Download JSON$/ }).click(),
      ])
      expect(jsonDownload.suggestedFilename()).toMatch(/-signed-record\.json$/)

      await page.route(
        `**/auth/namespaces/${seededRepo.namespace}/repos/${seededRepo.repo}/permissions**`,
        (route) =>
          route.fulfill({
            json: {
              permissions: {
                rename: false,
                transfer: false,
                manageCollaborators: false,
                manageApprovers: false,
                editMetadata: false,
                deleteRepository: false,
                viewSignedRecord: false,
                contentsWrite: true,
                isApprover: false,
              },
            },
          }),
      )
      await page.goto(repoPath(seededRepo, '/commits'))
      await page.locator('.history-list a').first().click()
      await expect(page.getByRole('link', { name: /Browse tree/i })).toBeVisible()
      await expect(page.getByTestId('signed-record-report')).toHaveCount(0)

      await page.route(
        `**/auth/namespaces/${seededRepo.namespace}/repos/${seededRepo.repo}/permissions**`,
        (route) =>
          route.fulfill({
            json: {
              permissions: {
                rename: false,
                transfer: false,
                manageCollaborators: false,
                manageApprovers: false,
                editMetadata: false,
                deleteRepository: false,
                viewSignedRecord: true,
                contentsWrite: true,
                isApprover: false,
              },
            },
          }),
      )
      await page.goto(repoPath(seededRepo, '/commits'))
      await page.locator('.history-list a').first().click()
      const detail = page.locator('.history-detail-actions')
      await expect(detail.getByRole('link', { name: /Browse tree/i })).toBeVisible()
      await expect(detail.getByRole('button', { name: /^Download PDF$/ })).toBeVisible()
      await expect(detail.getByRole('button', { name: /^Download JSON$/ })).toHaveCount(0)
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
      await page.getByRole('link', { name: 'Session cookie keys', exact: true }).click()
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
      await expect(page.getByTestId('restore-test-gate')).toContainText(/Not passed yet/)

      const record = section.getByRole('button', { name: 'Record restore test pass' })
      await expect(record).toBeEnabled()
      await record.click()
      await expect(
        section.getByRole('status').filter({ hasText: 'Restore test recorded as passed.' }),
      ).toBeVisible()
      await expect(page.getByTestId('restore-test-gate')).toContainText(/^Passed/)
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

    test('TC-GXP-101-03: signed merge refusal links to Settings → Restore test', async ({
      page,
    }) => {
      const mrId = 'mr-101-restore'
      const hash = 'a'.repeat(64)
      await mintSession(page, {
        role: 'admin',
        sub: uniqueId('gxp101-appr'),
        iss: 'mice-e2e',
        name: 'Restore Approver',
      })
      await page.route(`**/auth/merge-requests/${mrId}`, (route) => {
        if (route.request().method() !== 'GET') return route.fallback()
        return route.fulfill({
          json: {
            mergeRequest: {
              id: mrId,
              namespace: 'demo',
              repo: 'sample',
              sourceBranch: 'feature',
              targetBranch: 'main',
              expectedSourceHead: 's'.repeat(40),
              expectedTargetHead: 't'.repeat(40),
              status: 'open',
              openedBy: 'mice-e2e|other-opener',
              title: 'Restore gate MR',
              description: '',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          },
        })
      })
      await page.route('**/auth/namespaces/demo/repos/sample/permissions', (route) =>
        route.fulfill({
          json: {
            permissions: {
              rename: false,
              transfer: false,
              manageCollaborators: false,
              manageApprovers: false,
              editMetadata: false,
              deleteRepository: false,
              viewSignedRecord: true,
              contentsWrite: true,
              isApprover: true,
            },
          },
        }),
      )
      await page.route('**/api/repos/demo/sample/compare/**', (route) =>
        route.fulfill({
          json: { status: 'success', compare: { commits: [], entries: [], counts: { added: 0, removed: 0, modified: 0 } } },
        }),
      )
      await page.route(`**/auth/merge-requests/${mrId}/signing-preview**`, (route) =>
        route.fulfill({
          json: {
            hash,
            content: 'manifest',
            manifest: 'manifest',
            validatedTarget: true,
            meaning: 'Approved',
            principal: { iss: 'mice-e2e', sub: 'gxp101', name: 'Restore Approver' },
            binding: {
              repo: 'demo/sample',
              sourceHead: 's'.repeat(40),
              targetHead: 't'.repeat(40),
              manifestDigest: hash,
            },
            mergeRequest: {
              id: mrId,
              sourceBranch: 'feature',
              targetBranch: 'main',
              expectedSourceHead: 's'.repeat(40),
              expectedTargetHead: 't'.repeat(40),
            },
          },
        }),
      )
      await page.route('**/auth/sign/execute**', (route) =>
        route.fulfill({
          json: { signature: { id: 'sig-101', changeControlId: 'CC-20260101-e2e10101', hash } },
        }),
      )
      await page.route(`**/auth/merge-requests/${mrId}/complete**`, (route) =>
        route.fulfill({
          status: 503,
          json: { error: 'Restore test required', code: 'restore_test_required' },
        }),
      )

      await page.goto(`/n/demo/r/sample/merge-requests/${mrId}`)
      await page.getByRole('button', { name: 'Approve' }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await dialog.getByLabel('Reason').fill('E2E restore-test refusal path coverage')
      await dialog.getByLabel(/Change-control/i).fill('CC-20260101-e2e10101')
      await dialog.getByRole('button', { name: /Review signature/i }).click()
      await expect(dialog.getByText(/Review before signing/i)).toBeVisible()
      await dialog.getByRole('button', { name: /Sign and complete merge/i }).click()
      const alert = page.getByTestId('merge-sign-error')
      await expect(alert).toBeVisible({ timeout: 30_000 })
      await expect(alert).toContainText(/restore test must pass/i)
      await expect(alert.getByRole('link', { name: /Settings → Restore test/i })).toHaveAttribute(
        'href',
        '/settings#restore-test',
      )
    })
  })
})
