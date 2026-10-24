import { test, expect, repoPath, acceptConfirmModal } from '../fixtures'
import { createBranch, putFile } from '../helpers/oxenApi'

test.describe('branches & commits (B/C)', () => {
  test('branch detail owns info, metadata, and power tools; listing actions are icon-only', async ({ page, seededRepo }) => {
    await createBranch(seededRepo.namespace, seededRepo.repo, 'feature/details', 'main')
    await page.goto(repoPath(seededRepo, '/branches'))
    const row = page.locator('tr[data-branch="feature/details"]')
    for (const action of await row.locator('.branch-row-actions a, .branch-row-actions button').all()) {
      await expect(action).toHaveText('')
      await expect(action).toHaveAttribute('aria-label', /.+/)
    }
    await expect(row.getByTestId('meta-pills')).toHaveCount(0)
    await expect(row.getByRole('link', { name: 'History for feature/details', exact: true })).toHaveAttribute('href', /\/commits\?branch=feature%2Fdetails$/)
    await row.getByRole('link', { name: 'History for feature/details', exact: true }).click()
    await expect(page).toHaveURL(/\/commits\?branch=feature%2Fdetails$/)
    await page.getByRole('navigation', { name: 'Repository', exact: true }).getByRole('link', { name: 'Branches', exact: true }).click()
    await row.getByRole('link', { name: 'feature/details', exact: true }).click()
    await expect(page).toHaveURL(/\/branches\/feature%2Fdetails$/)
    await expect(page.getByRole('heading', { name: /^Branch: feature\/details/ })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Branch info', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Browse files', exact: true })).toHaveAttribute('href', /\/tree\/feature%2Fdetails$/)
    const metadata = page.getByRole('region', { name: 'Branch metadata', exact: true })
    await metadata.getByLabel('Add tag').fill('branch-only')
    await metadata.getByRole('button', { name: 'Add tag', exact: true }).click()
    await expect(metadata.getByTestId('meta-tags')).toContainText('branch-only')
    await page.reload()
    await expect(metadata.getByTestId('meta-tags')).toContainText('branch-only')
    await expect(page.getByRole('button', { name: 'Update tip', exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'All branches', exact: true }).click()
    await page.locator('tr[data-branch="main"]').getByRole('link', { name: 'main', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Cannot delete default branch', exact: true })).toBeDisabled()
    await expect(metadata.getByTestId('meta-tags')).not.toContainText('branch-only')
  })

  test('branch detail deletion returns to listing', async ({ page, seededRepo }) => {
    await createBranch(seededRepo.namespace, seededRepo.repo, 'delete-detail', 'main')
    await page.goto(repoPath(seededRepo, '/branches/delete-detail'))
    await page.getByRole('button', { name: 'Delete branch', exact: true }).click()
    await acceptConfirmModal(page, 'delete-detail')
    await expect(page).toHaveURL(/\/branches$/)
    await expect(page.locator('tr[data-branch="delete-detail"]')).toHaveCount(0)
  })

  test('B-01 B-02 B-05: list, create branch, block delete main', async ({
    page,
    seededRepo,
  }) => {
    await page.goto(repoPath(seededRepo, '/branches'))
    await expect(
      page.getByRole('heading', { name: 'Branches' }),
    ).toBeVisible()
    await expect(page.getByRole('link', { name: 'main', exact: true })).toBeVisible()

    const mainDelete = page.getByRole('button', {
      name: 'Cannot delete default branch',
    })
    await expect(mainDelete).toBeDisabled()

    await page.getByRole('button', { name: 'New branch' }).click()
    const dialog = page.getByRole('dialog', { name: 'Create a branch' })
    await dialog.getByLabel('Branch name').fill('feature')
    await dialog.getByLabel('Source branch', { exact: true }).selectOption('main')
    await dialog.getByRole('button', { name: 'Create branch' }).click()

    await expect(page.getByRole('link', { name: 'feature', exact: true })).toBeVisible({
      timeout: 30_000,
    })

    await page
      .getByRole('button', { name: 'Delete branch feature' })
      .click()
    await acceptConfirmModal(page, 'feature')
    await expect(page.getByRole('link', { name: 'feature', exact: true })).toHaveCount(0, {
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
