import { expect } from '@playwright/test'
import { cleanTest as test } from '../fixtures'
import { uniqueId } from '../helpers/oxenApi'
import { mintSession } from '../helpers/session'

/**
 * #148 — Repo settings chrome follows GET …/permissions (not a parallel role matrix).
 */
test.describe('Repo settings viewer permissions (#148)', () => {
  test('TC-148-01: read-only payload hides mutate chrome; Owner payload shows it', async ({
    page,
  }) => {
    const ns = uniqueId('rs-ns')
    const repo = uniqueId('rs-repo')
    await mintSession(page, {
      role: 'user',
      sub: uniqueId('rs-reader'),
      iss: 'mice-e2e',
      name: 'Repo Reader',
    })

    const readOnly = {
      rename: false,
      transfer: false,
      manageCollaborators: false,
      manageApprovers: false,
      editMetadata: false,
      deleteRepository: false,
      viewSignedRecord: true,
    }
    await page.route(
      `**/auth/namespaces/${ns}/repos/${repo}/permissions`,
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ permissions: readOnly }),
        })
      },
    )
    // Avoid hard dependency on oxen repo existence for chrome checks.
    await page.route(`**/auth/namespaces/${ns}/repos/${repo}/collaborators**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ collaborators: [] }),
      })
    })
    await page.route(`**/auth/namespaces/${ns}/repos/${repo}/approvers**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ approvers: [] }),
      })
    })
    await page.route(`**/auth/namespaces/${ns}/custom-roles**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ namespaceRoles: [], repoRoles: [] }),
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
    await expect(page.getByRole('heading', { name: 'Approvers', exact: true })).toBeVisible({
      timeout: 20_000,
    })
    await expect(page.getByRole('heading', { name: 'Rename', exact: true })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Transfer', exact: true })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Collaborators', exact: true })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Danger zone', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Add approver|Grant|Add collaborator/i })).toHaveCount(
      0,
    )

    const owner = {
      rename: true,
      transfer: true,
      manageCollaborators: true,
      manageApprovers: true,
      editMetadata: true,
      deleteRepository: true,
      viewSignedRecord: true,
    }
    await page.unroute(`**/auth/namespaces/${ns}/repos/${repo}/permissions`)
    await page.route(
      `**/auth/namespaces/${ns}/repos/${repo}/permissions`,
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ permissions: owner }),
        })
      },
    )
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Rename', exact: true })).toBeVisible({
      timeout: 20_000,
    })
    await expect(page.getByRole('heading', { name: 'Transfer', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Collaborators', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Danger zone', exact: true })).toBeVisible()
  })
})
