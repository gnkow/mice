import { test, expect } from '../fixtures'
import { uniqueId } from '../helpers/oxenApi'
import { mintSession } from '../helpers/session'

const AUTH_URL = process.env.AUTH_URL ?? 'http://localhost:8080'
const GROUP_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const DISPLAY_NAME = 'Quality Assurance E2E'
const BINDING_KEY = `mice-e2e|${GROUP_ID}`

async function claimNamespace(page: import('@playwright/test').Page, name: string) {
  const res = await page.request.post(`${AUTH_URL}/auth/namespaces`, {
    data: {
      name,
      basePermission: 'none',
      membersCanCreateRepos: true,
    },
  })
  if (!res.ok() && res.status() !== 409) {
    throw new Error(`claimNamespace failed ${res.status()}: ${await res.text()}`)
  }
}

test.describe('Group display names (#08)', () => {
  test('TC-GROUP-DN-01: namespace members list prefers cached display name over object id', async ({
    page,
  }) => {
    const ns = uniqueId('grp-dn')
    await mintSession(page)
    await claimNamespace(page, ns)

    await page.route(`**/auth/namespaces/${encodeURIComponent(ns)}`, async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          name: ns,
          description: '',
          basePermission: 'none',
          membersCanCreateRepos: true,
          unresolvedGroups: [],
          members: [
            {
              kind: 'group',
              group: BINDING_KEY,
              name: DISPLAY_NAME,
              role: 'member',
              bindingMode: 'id-based',
            },
          ],
        }),
      })
    })

    await page.goto(`/n/${encodeURIComponent(ns)}/settings`)
    await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible()

    const row = page.locator('.ns-member-row').filter({
      has: page.locator('.group-principal-name', { hasText: DISPLAY_NAME }),
    })
    await expect(row).toBeVisible()
    await expect(row.locator('.group-principal-name')).toHaveText(DISPLAY_NAME)
    await expect(row.locator('.group-principal-id')).toContainText(GROUP_ID)
    await expect(row.getByText(/ID-based binding/i)).toBeVisible()
    await expect(row.locator('code.ns-member-sub')).toHaveCount(0)
  })

  test('TC-GROUP-DN-02: directory manual entry keeps object id and display name distinct', async ({
    page,
  }) => {
    const ns = uniqueId('grp-dn-ui')
    await mintSession(page)
    await claimNamespace(page, ns)

    await page.goto(`/n/${encodeURIComponent(ns)}/settings`)
    await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible()

    await page.getByLabel('Identity').selectOption('group')
    await page.getByRole('button', { name: /Manual entry/i }).click()

    await expect(page.getByLabel('Group object id')).toBeVisible()
    await expect(page.getByLabel('Display name')).toBeVisible()
    await expect(page.getByText(/Grants bind to the object id/i)).toBeVisible()

    await page.getByLabel('Group object id').fill(GROUP_ID)
    await page.getByLabel('Display name').fill(DISPLAY_NAME)

    await expect(page.locator('.directory-picker-selected')).toContainText(DISPLAY_NAME)
    await expect(page.locator('.directory-picker-selected .group-principal-id')).toContainText(
      GROUP_ID,
    )
  })
})
