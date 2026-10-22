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
    await page.getByRole('button', { name: 'New job' }).click()
    const dialog = page.getByRole('dialog', { name: 'New job' })
    await expect(dialog.getByRole('tab')).toHaveText(['Local', 'Cluster'])
    await expect(dialog.getByText(/local commit/i)).toBeVisible()
    await dialog.getByRole('tab', { name: 'Cluster' }).click()
    await expect(dialog.getByText('JOBS_RUNNER').first()).toBeVisible()
  })
})
