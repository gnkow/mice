import { test, expect, openAccountMenu } from '../fixtures'
import { mintSession } from '../helpers/session'

test.describe('IdP MFA Baseline (Admin)', () => {
  test('admin can view and trigger IdP baseline check', async ({ page }) => {
    await mintSession(page, { role: 'admin' })
    // Navigate to Settings
    await page.goto('/')
    await openAccountMenu(page)
    await page
      .locator('.profile-menu-panel')
      .getByRole('link', { name: 'Settings' })
      .click()

    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

    // Navigate to IdP MFA Baseline section
    await page.getByRole('link', { name: 'Baseline', exact: true }).click()

    // Verify section is visible
    await expect(page.getByRole('heading', { name: /IdP MFA Baseline/i })).toBeVisible()
    await expect(page.getByText(/Part 11.*requires two distinct identification/i)).toBeVisible()

    // Verify "Check Now" button exists
    const checkButton = page.locator('#idp-baseline').getByRole('button', { name: /Check Now|Checking/i })
    await expect(checkButton).toBeVisible()

    // Trigger baseline check
    await checkButton.click()

    // Wait for check to complete (button changes to "Checking..." and back)
    await expect(checkButton).toBeDisabled()
    await expect(checkButton).toHaveText(/Checking/i, { timeout: 2000 })
    
    // Wait for result (either success or error message)
    await expect(
      page.locator('.flash-success, .flash-error, .flash-warning').first()
    ).toBeVisible({ timeout: 10000 })

    // Verify status section shows last check information
    await expect(page.getByText(/Last Check/i)).toBeVisible()
  })

  test('baseline status shows MFA availability', async ({ page }) => {
    await mintSession(page, { role: 'admin' })
    await page.goto('/')
    await openAccountMenu(page)
    await page
      .locator('.profile-menu-panel')
      .getByRole('link', { name: 'Settings' })
      .click()

    // Navigate to IdP baseline section
    await page.getByRole('link', { name: 'Baseline', exact: true }).click()

    // If a check has been performed, verify the status display
    const lastCheckText = page.getByText(/Last Check/i)
    if (await lastCheckText.isVisible()) {
      // Verify MFA Available status is shown
      await expect(page.getByText(/MFA Available/i)).toBeVisible()
      
      // Status should be either Yes or No
      const statusText = await page.locator('.flash-success, .flash-warning').textContent()
      expect(statusText).toMatch(/(Yes|No)/)
    }
  })
})
