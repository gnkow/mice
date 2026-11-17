import { test, expect, repoPath, repoTitle } from '../fixtures'
import { deleteRepo, uniqueId } from '../helpers/oxenApi'

test.describe('repository manage (R-05 R-06 R-07–R-09)', () => {
  test('R-05: rename updates display name and keeps the stable id path', async ({
    page,
    seededRepo,
  }) => {
    const nextName = 'renamed-repo'
    await page.goto(repoPath(seededRepo, '/settings'))
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

    await page.getByPlaceholder('New name').fill(nextName)
    await page.getByRole('button', { name: 'Rename' }).click()

    await expect(page).toHaveURL(
      new RegExp(`/n/${seededRepo.namespace}/r/${nextName}/tree/`),
      { timeout: 30_000 },
    )
    await expect(repoTitle(page, nextName)).toBeVisible()

    // Fixture teardown still targets the original name — delete the renamed row.
    await deleteRepo(seededRepo.namespace, nextName)
  })

  test('R-06: transfer moves repo to another namespace', async ({
    page,
    seededRepo,
  }) => {
    const targetNs = uniqueId('mice-e2e-xfer')
    await page.goto(repoPath(seededRepo, '/settings'))

    await page.getByPlaceholder('Target namespace').fill(targetNs)
    await page.getByRole('button', { name: 'Transfer' }).click()

    await expect(page).toHaveURL(
      new RegExp(`/n/${targetNs}/r/${seededRepo.repo}/tree/`),
      { timeout: 30_000 },
    )
    await expect(repoTitle(page, seededRepo.repo)).toBeVisible()

    // Fixture teardown deletes original ns/repo — clean transferred location.
    await deleteRepo(targetNs, seededRepo.repo)
  })

  test('R-07 R-08 R-09: size and stats on overview', async ({
    page,
    seededRepo,
  }) => {
    await page.goto(repoPath(seededRepo))
    const about = page.locator('aside.repo-aside')
    await expect(about.getByText(/\bsize\b/i)).toBeVisible({ timeout: 15_000 })
    await about
      .getByRole('button', { name: 'Refresh size and metadata' })
      .click()
    await expect(about.locator('.flash-error')).toHaveCount(0)
    await expect(about.getByText(/\bsize\b/i)).toBeVisible()
  })
})
