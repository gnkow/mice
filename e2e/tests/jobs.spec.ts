import { test, expect, repoPath } from '../fixtures'

test.describe('Jobs UI', () => {
  test('home Jobs tile links to jobs list', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible()
    await page.getByRole('link', { name: /Jobs/ }).click()
    await expect(page).toHaveURL(/\/jobs/)
    await expect(page.getByRole('heading', { name: 'Jobs' })).toBeVisible()
  })

  test('repo Jobs tab lists jobs; submit opens CLI modal', async ({
    page,
    seededRepo,
  }) => {
    await page.goto(repoPath(seededRepo, '/jobs'))
    await expect(page.getByRole('heading', { name: 'Jobs' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Detail' })).toHaveCount(0)
    await page.locator('summary', { hasText: 'New job' }).click()
    await page.getByRole('menuitem', { name: /Run on your machine/ }).click()
    await expect(
      page.getByRole('dialog', { name: 'New job — Local' }),
    ).toBeVisible()
    await expect(page.getByText(/local commit/i)).toBeVisible()
  })
})
