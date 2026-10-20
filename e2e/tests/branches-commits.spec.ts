import { test, expect, repoPath, acceptConfirmModal } from '../fixtures'
import { createBranch, putFile } from '../helpers/oxenApi'

test.describe('branches & commits (B/C)', () => {
  test('B-01 B-02 B-05: list, create branch, block delete main', async ({
    page,
    seededRepo,
  }) => {
    await page.goto(repoPath(seededRepo, '/branches'))
    await expect(
      page.getByRole('heading', { name: 'Branches' }),
    ).toBeVisible()
    await expect(page.getByRole('link', { name: 'main' })).toBeVisible()

    const mainDelete = page.getByRole('button', {
      name: 'Cannot delete default branch',
    })
    await expect(mainDelete).toBeDisabled()

    await page.getByRole('button', { name: 'New branch' }).click()
    const dialog = page.getByRole('dialog', { name: 'Create a branch' })
    await dialog.getByLabel('Branch name').fill('feature')
    await dialog.getByLabel('Source').selectOption('main')
    await dialog.getByRole('button', { name: 'Create branch' }).click()

    await expect(page.getByRole('link', { name: 'feature' })).toBeVisible({
      timeout: 30_000,
    })

    await page
      .getByRole('button', { name: 'Delete branch feature' })
      .click()
    await acceptConfirmModal(page, 'feature')
    await expect(page.getByRole('link', { name: 'feature' })).toHaveCount(0, {
      timeout: 30_000,
    })
  })

  test('C-01 C-02 C-03 C-05: commits list, path filter, detail, root', async ({
    page,
    seededRepo,
  }) => {
    await putFile(
      seededRepo.namespace,
      seededRepo.repo,
      'main',
      'notes/a.txt',
      'note\n',
      'add note',
    )

    await page.goto(repoPath(seededRepo, '/commits'))
    await expect(page.getByRole('heading', { name: 'History' })).toBeVisible()
    await expect(page.getByText(/Root/)).toBeVisible()

    await page.getByRole('tab', { name: 'All commits' }).click()
    await expect(page.getByRole('link', { name: /add note/ })).toBeVisible()
    await expect(page.getByRole('link', { name: /seed readme/ })).toBeVisible()

    await page.getByRole('tab', { name: 'Revision history' }).click()
    const pathFilter = page.getByPlaceholder('e.g. data or README.md')
    await pathFilter.fill('notes')
    await pathFilter.press('Enter')
    await expect(page.getByText(/Showing commits that touch/)).toBeVisible()
    await expect(page.locator('.commit-msg', { hasText: 'add note' })).toBeVisible()

    await page.locator('.history-list .commit-list a').first().click()
    await expect(page).toHaveURL(/\/commits\/[a-f0-9]+/)
    await expect(
      page.locator('.history-detail').getByRole('heading').first(),
    ).toBeVisible()
    await expect(page.getByText('Parents')).toBeVisible()
  })

  test('D-01 D-02 C-06: compare branches shows commits and entries', async ({
    page,
    seededRepo,
  }) => {
    await createBranch(
      seededRepo.namespace,
      seededRepo.repo,
      'feature',
      'main',
    )
    await putFile(
      seededRepo.namespace,
      seededRepo.repo,
      'feature',
      'extra.txt',
      'on feature\n',
      'feature file',
    )

    await page.goto(
      repoPath(seededRepo, '/compare?base=main&head=feature'),
    )
    await expect(page.getByRole('heading', { name: 'Compare' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'extra.txt' })).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByRole('link', { name: /feature file/ })).toBeVisible()
  })
})
