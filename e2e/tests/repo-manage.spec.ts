import { test, expect, repoPath, repoTitle } from '../fixtures'
import { createNamespace, deleteRepo, uniqueId } from '../helpers/oxenApi'

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

  test('R-06: AuthZ transfer one-shot moves repo when caller owns dest', async ({
    page,
    seededRepo,
  }) => {
    const targetNs = uniqueId('mice-e2e-xfer')
    // Same suite identity owns both namespaces → server one-shots.
    await createNamespace(targetNs)

    await page.goto(repoPath(seededRepo, '/settings'))
    await expect(page.getByRole('heading', { name: 'Transfer', exact: true })).toBeVisible({
      timeout: 20_000,
    })

    const transfer = page.locator('#repo-transfer')
    await transfer.getByLabel('Target namespace').selectOption(targetNs)
    await expect(transfer.getByLabel('Access changes')).toBeVisible({
      timeout: 15_000,
    })
    await transfer.getByRole('button', { name: 'Transfer' }).click()

    // Ceremony may open in regulated envs; complete if present (R-05-style otherwise).
    const reasonDialog = page.getByRole('dialog', {
      name: /Reason and signature required/i,
    })
    if (await reasonDialog.isVisible().catch(() => false)) {
      await reasonDialog.getByLabel('Reason').fill(
        'E2E R-06 AuthZ transfer one-shot to destination namespace',
      )
      await reasonDialog.getByRole('button', { name: /Review signature/i }).click()
      const signDialog = page.getByRole('dialog', { name: /Electronic signature/i })
      if (await signDialog.isVisible({ timeout: 20_000 }).catch(() => false)) {
        await signDialog.getByRole('button', { name: /Sign and continue/i }).click()
      }
    }

    await expect(page).toHaveURL(
      new RegExp(`/n/${targetNs}/r/${seededRepo.repo}/tree/`),
      { timeout: 45_000 },
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
