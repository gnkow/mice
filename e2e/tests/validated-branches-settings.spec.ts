import { expect } from '@playwright/test'
import { cleanTest as test } from '../fixtures'
import { uniqueId } from '../helpers/oxenApi'
import { mintSession } from '../helpers/session'

/**
 * #116 UI — validated branches in repo settings + create branch plan.
 */
test.describe('Validated branches settings (#116 UI)', () => {
  test('TC-116-UI-01: settings lists default validated branch; Owner sees mark control', async ({
    page,
  }) => {
    const ns = uniqueId('vb-ns')
    const repo = uniqueId('vb-repo')
    await mintSession(page, {
      role: 'user',
      sub: uniqueId('vb-owner'),
      iss: 'mice-e2e',
      name: 'VB Owner',
    })

    await page.route(`**/auth/namespaces/${ns}/repos/${repo}/permissions`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          permissions: {
            rename: true,
            transfer: true,
            manageCollaborators: true,
            manageApprovers: true,
            editMetadata: true,
            deleteRepository: true,
            viewSignedRecord: true,
            contentsWrite: true,
            isApprover: false,
          },
        }),
      })
    })
    await page.route(`**/auth/repos/${ns}/${repo}/validated-branches`, async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            defaultBranch: 'main',
            validatedBranches: ['main'],
            branches: [
              {
                branch: 'main',
                markedAt: new Date().toISOString(),
                markedBy: null,
                reason: null,
                changeControlId: null,
              },
            ],
          }),
        })
        return
      }
      await route.continue()
    })
    await page.route(`**/api/repos/${ns}/${repo}/branches**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'success',
          status_message: 'ok',
          branches: [
            { name: 'main', commit_id: 'abc' },
            { name: 'feature', commit_id: 'def' },
          ],
        }),
      })
    })
    for (const path of ['collaborators', 'approvers'] as const) {
      await page.route(
        `**/auth/namespaces/${ns}/repos/${repo}/${path}**`,
        async (route) => {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(
              path === 'collaborators' ? { collaborators: [] } : { approvers: [] },
            ),
          })
        },
      )
    }
    await page.route(`**/auth/namespaces/${ns}/custom-roles**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ namespaceRoles: [], repoRoles: [] }),
      })
    })
    await page.route(`**/auth/namespaces/${ns}/repos/${repo}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          repository: { namespace: ns, name: repo, description: '' },
        }),
      })
    })
    await page.route('**/auth/meta**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ canEdit: false, tags: [], labels: [] }),
      })
    })

    await page.goto(`/n/${encodeURIComponent(ns)}/r/${encodeURIComponent(repo)}/settings`)
    const section = page.getByTestId('validated-branches-section')
    await expect(section).toBeVisible({ timeout: 20_000 })
    await expect(section.getByTestId('validated-branch-row')).toContainText('main')
    await expect(section.getByTestId('validated-branch-pick')).toBeVisible()
    await expect(section.getByTestId('validated-branch-mark')).toBeVisible()
    await expect(section.getByText(/does not change commit QC/i)).toBeVisible()
  })

  test('TC-116-UI-02: More options exposes branch plan with default+validated', async ({
    page,
  }) => {
    await mintSession(page, {
      role: 'user',
      sub: uniqueId('vb-create'),
      iss: 'mice-e2e',
      name: 'VB Creator',
    })
    await page.route('**/api/namespaces**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'success',
          status_message: 'ok',
          namespaces: [{ namespace: 'demo' }],
        }),
      })
    })
    await page.route('**/auth/namespaces**', async (route) => {
      const path = route.request().url().split('?')[0]!
      if (path.endsWith('/auth/namespaces')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ namespaces: [{ name: 'demo' }] }),
        })
        return
      }
      await route.continue()
    })
    await page.route('**/auth/me**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: { sub: 'vb-create', iss: 'mice-e2e', email: 'c@x.io' },
          effectivePermissions: ['namespace:create'],
        }),
      })
    })

    await page.goto('/repositories/new')
    await page.getByRole('button', { name: 'More' }).click()
    const section = page.getByTestId('new-repo-branches')
    await expect(section).toBeVisible({ timeout: 20_000 })
    await expect(section.getByTestId('new-repo-branch-list').locator('input[type="radio"]')).toHaveCount(1)
    await expect(section.locator('input[type="checkbox"]').first()).toBeChecked()
    await section.getByTestId('new-repo-add-branch').click()
    await expect(section.getByTestId('new-repo-branch-list').locator('li')).toHaveCount(2)
  })
})
