import { test, expect, openAccountMenu } from '../fixtures'
import { uniqueId } from '../helpers/oxenApi'
import { mintSession, mintSessionCookie } from '../helpers/session'

test.describe('Two instance admins (#39)', () => {
  test('Users grant shows admin-floor refuse when demoting under the floor', async ({ page }) => {
    const targetSub = uniqueId('floor-admin')
    const targetName = `Floor Admin ${targetSub}`
    await mintSessionCookie({
      role: 'admin',
      sub: targetSub,
      iss: 'mice-e2e',
      name: targetName,
      email: `${targetSub}@mice.local`,
    })
    await mintSession(page, {
      role: 'admin',
      sub: uniqueId('floor-actor'),
      iss: 'mice-e2e',
      name: 'Floor Actor',
      email: `floor-actor-${Date.now()}@mice.local`,
    })

    await page.goto('/')
    await openAccountMenu(page)
    await page
      .locator('.profile-menu-panel')
      .getByRole('link', { name: 'Settings' })
      .click()

    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
    await page
      .getByRole('list', { name: 'Access' })
      .getByRole('link', { name: 'Grant access', exact: true })
      .click()

    const users = page.locator('#users-grant')
    await expect(users.getByRole('heading', { name: 'Grant access' })).toBeVisible()
    await expect(
      users.getByText(/two or fewer instance admins/i),
    ).toBeVisible()

    // Force the floor via API so UI refuse path is deterministic regardless of bootstrap count.
    await page.route('**/auth/instance', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          enforce: true,
          admins: [
            { sub: targetSub, iss: 'mice-e2e', name: targetName },
            { sub: 'other-admin', iss: 'mice-e2e', name: 'Other Admin' },
          ],
          permissions: [],
        }),
      })
    })
    await page.reload()
    await page
      .getByRole('list', { name: 'Access' })
      .getByRole('link', { name: 'Grant access', exact: true })
      .click()

    const row = users.locator('li', { hasText: targetName })
    await row.getByRole('button', { name: 'Grant Access' }).click()
    await users.locator('select').selectOption({ label: 'User' })
    await expect(
      users.getByText(/Remove is refused while two or fewer instance admins remain/i),
    ).toBeVisible()
    await expect(users.getByRole('button', { name: 'Remove blocked' })).toBeDisabled()
  })

  test('API floor error surfaces as Admin floor alert', async ({ page }) => {
    await mintSession(page, {
      role: 'admin',
      sub: uniqueId('floor-api'),
      iss: 'mice-e2e',
    })
    await page.goto('/')
    await openAccountMenu(page)
    await page
      .locator('.profile-menu-panel')
      .getByRole('link', { name: 'Settings' })
      .click()
    await page
      .getByRole('list', { name: 'Access' })
      .getByRole('link', { name: 'Grant access', exact: true })
      .click()

    const users = page.locator('#users-grant')
    await page.route('**/auth/grants/role', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'At least two admins must remain' }),
        })
        return
      }
      await route.continue()
    })

    await users.getByRole('button', { name: 'Grant Access' }).first().click()
    await users.getByRole('button', { name: 'Manual entry' }).click()
    await users.getByLabel('Subject (sub)').fill(`not-an-admin-${Date.now()}`)
    await users.getByLabel('Issuer (iss)').fill('mice-e2e')
    await users.locator('select').selectOption({ label: 'User' })
    await users.getByLabel('Reason (required)').fill('Trying to demote under the floor')
    await users.getByRole('button', { name: 'Grant', exact: true }).click()
    await expect(users.getByRole('alert')).toContainText(/Admin floor:/i)
    await expect(users.getByRole('alert')).toContainText(/At least two admins must remain/i)
  })
})
