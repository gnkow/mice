import { test, expect } from '../fixtures'

test.describe('Sessions UI', () => {
  test('home Sessions tile links to sessions list', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible()
    await page.getByRole('link', { name: /Sessions/ }).click()
    await expect(page).toHaveURL(/\/sessions/)
    await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible()
  })

  test('nav Sessions page can create a mock session', async ({ page }) => {
    await page.goto('/sessions')
    await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible()
    await page.getByRole('button', { name: 'New session' }).click()
    await page
      .getByRole('dialog', { name: 'New session' })
      .getByRole('button', { name: 'Create session' })
      .click()
    // Creation navigates directly to the session detail page.
    await expect(page).toHaveURL(/\/sessions\/[0-9a-f]+/)
    await expect(
      page.getByText(/Ready|Connected|Provisioning/i).first(),
    ).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: 'Connect' })).toBeVisible()
  })
})
