import {
  test,
  expect,
  repoPath,
  acceptConfirmModal,
  fileRowAction,
  fileNameLink,
} from '../fixtures'
import { putFile } from '../helpers/oxenApi'

test.describe('blob + tree recent features', () => {
  test('blob tabs: preview, metadata, history, lineage', async ({
    page,
    seededRepo,
  }) => {
    await page.goto(repoPath(seededRepo, '/blob/main/readme.txt'))
    await expect(page.getByRole('heading', { name: 'readme.txt' })).toBeVisible()

    await page.getByTestId('blob-tab-details').click()
    await expect(page.locator('#blob-panel-details')).toBeVisible()
    await expect(page.locator('dt', { hasText: 'Content hash' })).toBeVisible()

    await page.getByTestId('blob-tab-metadata').click()
    await expect(page.locator('#blob-panel-metadata')).toBeVisible()

    await page.getByTestId('blob-tab-history').click()
    await expect(page.locator('#blob-panel-history')).toBeVisible()
    await expect(page.getByRole('heading', { name: /Versions from/ })).toBeVisible()

    await page.getByTestId('blob-tab-lineage').click()
    await expect(page.getByTestId('lineage-panel')).toBeVisible()

    await page.getByTestId('blob-tab-preview').click()
    await expect(page.locator('.blob-preview-panel')).toBeVisible()
  })

  test('blob text edit saves a new version', async ({ page, seededRepo }) => {
    await page.goto(repoPath(seededRepo, '/blob/main/readme.txt'))
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    const editor = page.getByTestId('blob-editor')
    await expect(editor).toBeVisible()

    const area = editor.locator('textarea')
    await area.fill('edited via blob page\n')
    await editor.getByLabel(/Commit message/i).fill('blob edit save')
    await editor.getByRole('button', { name: 'Save' }).click()

    await expect(page.locator('main .flash-success')).toContainText(/Saved/i, {
      timeout: 30_000,
    })
    await expect(page.getByTestId('blob-editor')).toHaveCount(0)
    await expect(page.getByText('edited via blob page')).toBeVisible()
  })

  test('blob restore after delete brings file back', async ({
    page,
    seededRepo,
  }) => {
    await putFile(
      seededRepo.namespace,
      seededRepo.repo,
      'main',
      'scratch.txt',
      'scratch body\n',
      'add scratch',
    )

    await page.goto(repoPath(seededRepo, '/blob/main/scratch.txt'))
    await expect(page.getByRole('heading', { name: 'scratch.txt' })).toBeVisible()

    await page.locator('details.blob-ops-menu').getByText('More').click()
    await page.getByRole('menuitem', { name: 'Delete file' }).click()
    await acceptConfirmModal(page)

    await expect(page).toHaveURL(/\/tree\/main/)
    await page.goto(repoPath(seededRepo, '/blob/main/scratch.txt'))
    await expect(page.getByTestId('blob-missing')).toBeVisible({
      timeout: 15_000,
    })
    await page.getByRole('button', { name: 'Restore latest version' }).click()
    await expect(page.locator('main .flash-success')).toContainText(/Restored/i, {
      timeout: 30_000,
    })
    await expect(page.getByTestId('blob-missing')).toHaveCount(0)
    await expect(page.getByText('scratch body')).toBeVisible()
  })

  test('tree rename keeps folder and updates name', async ({
    page,
    seededRepo,
  }) => {
    await page.goto(repoPath(seededRepo, '/tree/main'))
    await fileRowAction(page, 'readme.txt', 'Rename')
    await expect(page.getByTestId('path-change-rename')).toBeVisible()
    await page.getByLabel('New name').fill('NOTES.txt')
    await page
      .getByTestId('path-change-rename')
      .getByRole('button', { name: 'Rename' })
      .click()
    await expect(page.locator('main .flash-success')).toContainText(/Renamed/i, {
      timeout: 30_000,
    })
    await expect(fileNameLink(page, /^NOTES\.txt$/)).toBeVisible()
    // Oxen rename removes the old path; tree shows it as a deleted hint row.
    await expect(
      page.locator('a.file-name-link:not(.file-name-deleted)', {
        hasText: /^readme\.txt$/,
      }),
    ).toHaveCount(0)
    await expect(page.getByTestId('file-row-deleted')).toContainText(
      'readme.txt',
    )
  })

  test('tree copy keeps basename in another folder', async ({
    page,
    seededRepo,
  }) => {
    await page.goto(repoPath(seededRepo, '/tree/main'))
    await fileRowAction(page, 'readme.txt', 'Copy')
    await expect(page.getByTestId('path-change-copy')).toBeVisible()
    await page.getByLabel('Destination path').fill('copies/readme.txt')
    await page
      .getByTestId('path-change-copy')
      .getByRole('button', { name: 'Copy' })
      .click()
    await expect(page.locator('main .flash-success')).toContainText(/Copied/i, {
      timeout: 30_000,
    })

    await page.goto(repoPath(seededRepo, '/tree/main/copies'))
    await expect(fileNameLink(page, 'readme.txt')).toBeVisible({
      timeout: 15_000,
    })
    // Original still at root
    await page.goto(repoPath(seededRepo, '/tree/main'))
    await expect(fileNameLink(page, 'readme.txt')).toBeVisible()
  })

  test('tree shows deleted file and restores it', async ({
    page,
    seededRepo,
  }) => {
    await putFile(
      seededRepo.namespace,
      seededRepo.repo,
      'main',
      'gone-soon.txt',
      'temporary\n',
      'add gone-soon',
    )

    await page.goto(repoPath(seededRepo, '/tree/main'))
    await expect(fileNameLink(page, 'gone-soon.txt')).toBeVisible({
      timeout: 15_000,
    })
    await fileRowAction(page, 'gone-soon.txt', 'Delete')
    await acceptConfirmModal(page)

    await expect(page.getByTestId('file-row-deleted')).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByText('Deleted')).toBeVisible()
    await page
      .getByTestId('file-row-deleted')
      .getByRole('button', { name: 'Restore' })
      .click()
    await expect(page.locator('main .flash-success')).toContainText(/Restored/i, {
      timeout: 30_000,
    })
    await expect(fileNameLink(page, 'gone-soon.txt')).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByTestId('file-row-deleted')).toHaveCount(0)
  })
})
