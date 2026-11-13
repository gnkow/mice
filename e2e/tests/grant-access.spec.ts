import { test, expect, openAccountMenu } from '../fixtures'
import { mintSession } from '../helpers/session'

async function openSettingsSection(
  page: import('@playwright/test').Page,
  linkName: string,
  sectionId: string,
) {
  await page.goto('/')
  await openAccountMenu(page)
  await page
    .locator('.profile-menu-panel')
    .getByRole('link', { name: 'Settings' })
    .click()
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await page
    .getByRole('list', { name: 'Access' })
    .getByRole('link', { name: linkName, exact: true })
    .click()
  return page.locator(`#${sectionId}`)
}

test.describe('Grant access / no IdP bootstrap (#11)', () => {
  test('TC-GRANT-01: Grant access copy states IdP groups do not bootstrap roles', async ({
    page,
  }) => {
    await mintSession(page, { sub: `e2e-grant-${Date.now()}`, role: 'admin' })
    const section = await openSettingsSection(page, 'Grant access', 'users-grant')

    await expect(section.getByRole('heading', { name: 'Grant access' })).toBeVisible()
    await expect(
      section.getByText(/IdP groups do not bootstrap instance access/i),
    ).toBeVisible()
    await expect(
      section.getByRole('link', { name: 'pending access requests' }),
    ).toHaveAttribute('href', '#access-requests')
    await expect(section.getByRole('button', { name: 'Grant Access' }).first()).toBeVisible()
  })

  test('TC-GRANT-02: Access requests empty state explains manual grant path', async ({
    page,
  }) => {
    await mintSession(page, { sub: `e2e-ar-${Date.now()}`, role: 'admin' })

    await page.route('**/auth/access-requests', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ requests: [] }),
        })
        return
      }
      await route.continue()
    })

    const section = await openSettingsSection(page, 'Access requests', 'access-requests')
    await expect(section.getByTestId('access-requests-empty')).toBeVisible()
    await expect(
      section.getByText(/group membership alone does not unlock the app/i),
    ).toBeVisible()
    await expect(
      section.getByRole('link', { name: 'assign a role directly' }),
    ).toHaveAttribute('href', '#users-grant')
    await expect(section.getByTestId('access-requests-pending-count')).toHaveText('0 pending')
  })

  test('TC-GRANT-03: principal with IdP groups stays pending without a role', async ({
    page,
  }) => {
    await mintSession(page, {
      sub: `e2e-pending-grp-${Date.now()}`,
      role: 'none',
      groups: ['aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', 'mice-admins'],
    })
    await page.goto('/')
    await expect(page).toHaveURL(/\/pending$/)
    await expect(page.getByRole('heading', { name: /Request|pending/i }).first()).toBeVisible()
  })
})
