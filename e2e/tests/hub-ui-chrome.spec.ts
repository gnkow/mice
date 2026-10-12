import { test, expect, repoPath, acceptConfirmModal } from '../fixtures'
import {
  createBranch,
  createWorkspace,
  putFile,
} from '../helpers/oxenApi'

test.describe('hub UI chrome (Branches / Merge / Workspaces)', () => {
  test('branches: table, filter, create validation, MR enablement', async ({
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
      'ahead.txt',
      'ahead of main\n',
      'feature ahead',
    )

    await page.goto(repoPath(seededRepo, '/branches'))
    await expect(page.getByRole('heading', { name: 'Branches' })).toBeVisible()
    await expect(
      page.getByText(/Maintain multiple versions of your data/),
    ).toBeVisible()

    const table = page.locator('table.branches-table')
    await expect(table.getByRole('columnheader', { name: 'Branch' })).toBeVisible()
    await expect(table.getByRole('columnheader', { name: 'Updated' })).toBeVisible()
    await expect(
      table.getByRole('columnheader', { name: 'Commits ahead' }),
    ).toBeVisible()

    const mainRow = page.locator('tr[data-branch="main"]')
    await expect(mainRow.getByText('default', { exact: true })).toBeVisible()
    await expect(
      mainRow.getByRole('button', { name: 'Cannot delete default branch' }),
    ).toBeDisabled()
    await expect(
      mainRow.getByRole('button', { name: 'Create merge request' }),
    ).toBeDisabled()

    const featureRow = page.locator('tr[data-branch="feature"]')
    await expect(featureRow).toBeVisible()
    await expect
      .poll(async () => featureRow.locator('.branches-col-ahead').innerText(), {
        timeout: 30_000,
      })
      .toMatch(/^[1-9]\d*$/)

    const mr = featureRow.getByRole('link', { name: 'Create merge request' })
    await expect(mr).toBeVisible({ timeout: 30_000 })
    await expect(mr).toHaveAttribute(
      'href',
      new RegExp(`/merge\\?base=main&head=feature`),
    )
    await expect(
      featureRow.getByRole('link', { name: 'Compare', exact: true }),
    ).toHaveAttribute(
      'href',
      new RegExp(`/compare\\?base=main&head=feature`),
    )

    await page.getByPlaceholder('Filter branches…').fill('feat')
    await expect(page.locator('tr[data-branch="feature"]')).toBeVisible()
    await expect(page.locator('tr[data-branch="main"]')).toHaveCount(0)
    await page.getByPlaceholder('Filter branches…').fill('')
    await expect(page.locator('tr[data-branch="main"]')).toBeVisible()

    await page.getByRole('button', { name: 'New branch' }).click()
    const dialog = page.getByRole('dialog', { name: 'Create a branch' })
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('Branch name').fill('x')
    await expect(dialog.getByText('at least 2 characters')).toBeVisible()
    await expect(
      dialog.getByRole('button', { name: 'Create branch' }),
    ).toBeDisabled()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toHaveCount(0)

    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await page
      .getByRole('button', { name: 'Copy branch name feature' })
      .click()
    await expect(
      page.getByRole('button', { name: 'Copied feature' }),
    ).toBeVisible({ timeout: 5_000 })
  })

  test('branches: identical tip disables merge request', async ({
    page,
    seededRepo,
  }) => {
    await createBranch(
      seededRepo.namespace,
      seededRepo.repo,
      'same-tip',
      'main',
    )

    await page.goto(repoPath(seededRepo, '/branches'))
    const row = page.locator('tr[data-branch="same-tip"]')
    await expect(row).toBeVisible()
    await expect
      .poll(async () => row.locator('.branches-col-ahead').innerText(), {
        timeout: 30_000,
      })
      .toBe('0')

    const mr = row.getByRole('link', { name: 'Create merge request' })
    await expect(mr).toHaveAttribute('aria-disabled', 'true')
    await mr.click({ force: true })
    await expect(page).toHaveURL(/\/branches/)
  })

  test('merge: range chrome, swap, view diff, empty single-branch', async ({
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
      'm.txt',
      'merge chrome\n',
      'merge chrome commit',
    )

    await page.goto(repoPath(seededRepo, '/merge?base=main&head=feature'))
    await expect(page.getByRole('heading', { name: 'Merge', exact: true })).toBeVisible()
    await expect(
      page.getByText(/Bring commits from one branch into another/),
    ).toBeVisible()

    await expect(page.getByLabel('Head branch (from)')).toHaveValue('feature')
    await expect(page.getByLabel('Base branch (into)')).toHaveValue('main')
    await expect(page.locator('.merge-range-key')).toHaveText('main..feature')

    await expect(page.getByText('Mergeable', { exact: true })).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.locator('.merge-summary')).toContainText(/\d+ commits?/)

    const viewDiff = page
      .locator('.merge-page-head')
      .getByRole('link', { name: 'View diff' })
    await expect(viewDiff).toHaveAttribute(
      'href',
      /\/compare\?base=main&head=feature/,
    )

    await page.getByRole('button', { name: 'Swap base and head branches' }).click()
    await expect(page).toHaveURL(/base=feature&head=main/)
    await expect(page.getByLabel('Head branch (from)')).toHaveValue('main')
    await expect(page.getByLabel('Base branch (into)')).toHaveValue('feature')

    await page.goto(repoPath(seededRepo, '/merge?base=main&head=main'))
    await expect(
      page.getByText('Pick two different branches to merge.'),
    ).toBeVisible({ timeout: 15_000 })
  })

  test('merge: already up to date when tips match', async ({
    page,
    seededRepo,
  }) => {
    await createBranch(
      seededRepo.namespace,
      seededRepo.repo,
      'twin',
      'main',
    )

    await page.goto(repoPath(seededRepo, '/merge?base=main&head=twin'))
    await expect(page.getByText('Already up to date')).toBeVisible({
      timeout: 30_000,
    })
    await expect(
      page.getByRole('button', { name: 'Merge twin → main' }),
    ).toBeDisabled()
  })

  test('workspaces: table, filter, open, list delete, detail back link', async ({
    page,
    seededRepo,
  }) => {
    const a = await createWorkspace(
      seededRepo.namespace,
      seededRepo.repo,
      'main',
      'alpha-ws',
    )
    await createWorkspace(
      seededRepo.namespace,
      seededRepo.repo,
      'main',
      'beta-ws',
    )

    await page.goto(repoPath(seededRepo, '/workspaces'))
    await expect(page.getByRole('heading', { name: 'Workspaces' })).toBeVisible()
    await expect(
      page.getByText(/Stage and commit changes on the server/),
    ).toBeVisible()

    const table = page.locator('table.workspaces-table')
    await expect(
      table.getByRole('columnheader', { name: 'Workspace' }),
    ).toBeVisible()
    await expect(table.getByRole('columnheader', { name: 'Base' })).toBeVisible()
    await expect(
      table.getByRole('columnheader', { name: 'Created' }),
    ).toBeVisible()

    await expect(page.locator(`tr[data-workspace="${a.id}"]`)).toBeVisible()
    await expect(page.getByRole('link', { name: 'alpha-ws' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'beta-ws' })).toBeVisible()

    await page.getByPlaceholder('Filter workspaces…').fill('alpha')
    await expect(page.getByRole('link', { name: 'alpha-ws' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'beta-ws' })).toHaveCount(0)
    await page.getByPlaceholder('Filter workspaces…').fill('')

    await page
      .locator(`tr[data-workspace="${a.id}"]`)
      .getByRole('link', { name: 'Open' })
      .click()
    await expect(page).toHaveURL(new RegExp(`/workspaces/${a.id}$`))
    await expect(page.getByRole('heading', { name: 'alpha-ws' })).toBeVisible()
    await expect(page.getByRole('link', { name: '← Workspaces' })).toBeVisible()

    await page.getByRole('link', { name: '← Workspaces' }).click()
    await expect(page).toHaveURL(/\/workspaces$/)

    await page
      .getByRole('button', { name: 'Delete workspace beta-ws' })
      .click()
    await acceptConfirmModal(page, 'beta-ws')
    await expect(page.getByRole('link', { name: 'beta-ws' })).toHaveCount(0, {
      timeout: 30_000,
    })

    await page.getByRole('button', { name: 'New workspace' }).click()
    const dialog = page.getByRole('dialog', { name: 'New workspace' })
    await expect(dialog.getByLabel('Name')).toBeVisible()
    await expect(dialog.getByLabel('Base branch')).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toHaveCount(0)
  })

  test('workspaces: staged summary after upload', async ({
    page,
    seededRepo,
  }) => {
    const ws = await createWorkspace(
      seededRepo.namespace,
      seededRepo.repo,
      'main',
      'staged-ui',
    )
    await page.goto(
      repoPath(seededRepo, `/workspaces/${encodeURIComponent(ws.id)}`),
    )
    await expect(page.getByRole('heading', { name: 'staged-ui' })).toBeVisible()

    const uploadSection = page.locator('section', { hasText: 'Upload file' })
    await uploadSection.locator('input[name="file"]').setInputFiles({
      name: 'ui-stage.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('staged via ui chrome test\n'),
    })
    await uploadSection.getByRole('button', { name: 'Stage upload' }).click()

    await expect(
      page.getByText('1 staged change', { exact: true }),
    ).toBeVisible({ timeout: 30_000 })
    await expect(
      page.getByRole('link', { name: 'Jump to commit' }),
    ).toHaveAttribute('href', '#workspace-commit')
    await expect(
      page.locator('#workspace-commit').getByText(/Mergeable into main/i),
    ).toBeVisible({ timeout: 30_000 })
  })
})
