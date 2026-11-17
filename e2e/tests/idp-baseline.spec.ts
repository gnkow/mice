import { test, expect, openSettings } from '../fixtures'
import { mintSession } from '../helpers/session'

test.describe('IdP MFA Baseline (Admin)', () => {
  test('admin can view and trigger IdP baseline check', async ({ page }) => {
    await mintSession(page, { sub: 'e2e-admin', role: 'admin' })
    await page.goto('/')
    await openSettings(page)

    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

    await page.getByRole('link', { name: 'IdP baseline', exact: true }).click()

    await expect(page.getByRole('heading', { name: /IdP MFA Baseline/i })).toBeVisible()
    await expect(page.getByText(/Part 11.*requires two distinct identification/i)).toBeVisible()

    const section = page.locator('#idp-baseline')
    await expect(
      section.getByText(/Last check|No baseline checks have been performed yet|Loading baseline status/i).first(),
    ).toBeVisible({ timeout: 10_000 })

    const checkButton = section.getByRole('button', { name: /Check Now|Checking/i })
    await expect(checkButton).toBeVisible()

    await checkButton.click()

    await expect(checkButton).toBeDisabled()
    await expect(checkButton).toHaveText(/Checking/i, { timeout: 2000 })

    await expect(checkButton).toBeEnabled({ timeout: 10_000 })
    await expect(
      section.getByText(/Last check|Could not load IdP baseline|Check failed/i).first(),
    ).toBeVisible()
  })

  test('baseline status shows MFA availability after a check', async ({ page }) => {
    await mintSession(page, { sub: 'e2e-admin', role: 'admin' })
    await page.goto('/')
    await openSettings(page)

    await page.getByRole('link', { name: 'IdP baseline', exact: true }).click()

    const section = page.locator('#idp-baseline')
    const checkButton = section.getByRole('button', { name: /Check Now|Checking/i })
    await checkButton.click()
    await expect(checkButton).toBeEnabled({ timeout: 10_000 })

    const lastCheckLabel = section.getByText('Last check', { exact: true })
    if (await lastCheckLabel.isVisible()) {
      await expect(section.getByText('MFA', { exact: true })).toBeVisible()
      await expect(section.getByText(/Available|Not available/i).first()).toBeVisible()
    }
  })
})
