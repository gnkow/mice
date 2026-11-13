import { test, expect, openAccountMenu } from '../fixtures'
import { uniqueId } from '../helpers/oxenApi'
import { mintSession } from '../helpers/session'

test.describe('Mice suspension (#28)', () => {
  test('admin opens Suspension via Settings nav and sees empty guidance', async ({ page }) => {
    await mintSession(page, { sub: 'e2e-mice-admin', role: 'admin' })
    await page.goto('/')
    await openAccountMenu(page)
    await page
      .locator('.profile-menu-panel')
      .getByRole('link', { name: 'Settings' })
      .click()

    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
    await page.getByRole('link', { name: 'Suspension', exact: true }).click()

    const section = page.locator('#mice-suspension')
    await expect(section.getByRole('heading', { name: /Mice suspension/i })).toBeVisible()
    await expect(
      section.getByText(/Choose a user to suspend, lift, or review/i),
    ).toBeVisible()
    await expect(section.getByRole('button', { name: 'Suspend' })).toBeDisabled()
  })

  test('suspend without reason shows accessible error', async ({ page }) => {
    await mintSession(page, { sub: uniqueId('mice-admin'), role: 'admin', iss: 'mice-e2e' })
    await page.goto('/')
    await openAccountMenu(page)
    await page
      .locator('.profile-menu-panel')
      .getByRole('link', { name: 'Settings' })
      .click()
    await page.getByRole('link', { name: 'Suspension', exact: true }).click()

    const section = page.locator('#mice-suspension')
    await section.getByRole('button', { name: 'Manual entry' }).click()
    await section.getByLabel('Subject (sub)').fill(`mice-target-${Date.now()}`)
    await section.getByRole('button', { name: 'Suspend' }).click()
    await expect(section.getByRole('alert')).toContainText(/Reason must be at least 10 characters/i)
  })
})
