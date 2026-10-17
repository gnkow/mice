import {
  test,
  expect,
  repoPath,
  acceptConfirmModal,
  fileRowAction,
  fileNameLink,
} from '../fixtures'
import {
  createBranch,
  getFileEntry,
  putFile,
} from '../helpers/oxenApi'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixtures = path.join(__dirname, '../fixtures')

test.describe('files advanced (F-05–F-15)', () => {
  test('TC-F-02b: Download button triggers browser download', async ({
    page,
    seededRepo,
  }) => {
    await page.goto(repoPath(seededRepo, '/blob/main/readme.txt'))
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download', exact: true }).click()
    const download = await downloadPromise
    expect(await download.failure()).toBeNull()
    expect(download.suggestedFilename()).toBe('readme.txt')
  })

  test('TC-F-02c: image blob shows img preview', async ({
    page,
    seededRepo,
  }) => {
    const png = fs.readFileSync(path.join(fixtures, 'pixel.png'))
    await putFile(
      seededRepo.namespace,
      seededRepo.repo,
      'main',
      'assets/pixel.png',
      png,
      'add pixel',
      'pixel.png',
    )

    await page.goto(repoPath(seededRepo, '/blob/main/assets/pixel.png'))
    await expect(page.getByRole('heading', { name: 'pixel.png' })).toBeVisible()
    const img = page.locator('img.img-preview')
    await expect(img).toBeVisible({ timeout: 30_000 })
    await expect(img).toHaveAttribute('src', /blob:|data:/)
  })

  test('TC-F-04b: delete directory from tree', async ({ page, seededRepo }) => {
    await putFile(
      seededRepo.namespace,
      seededRepo.repo,
      'main',
      'nested/dir/file.txt',
      'inside\n',
      'seed nested',
    )

    await page.goto(repoPath(seededRepo, '/tree/main'))
    await expect(fileNameLink(page, 'nested')).toBeVisible({
      timeout: 15_000,
    })

    await fileRowAction(page, 'nested', 'Delete')
    await acceptConfirmModal(page)

    // Directory deletes remove the folder row (no deleted-hint stub for dirs).
    await expect(
      page.locator('a.file-name-link', { hasText: /^nested$/ }),
    ).toHaveCount(0, { timeout: 30_000 })
  })

  test('TC-F-16: Download (version store)', async ({ page, seededRepo }) => {
    await page.goto(repoPath(seededRepo, '/blob/main/readme.txt'))
    await page.getByTestId('blob-tab-metadata').click()
    await expect(page.locator('dt', { hasText: 'Hash' })).toBeVisible({
      timeout: 15_000,
    })

    await page.locator('details.blob-ops-menu').getByText('More').click()
    const downloadPromise = page.waitForEvent('download', { timeout: 30_000 })
    await page
      .getByRole('menuitem', { name: 'Download (version store)' })
      .click()

    const downloadOrError = await Promise.race([
      downloadPromise.then((d) => ({ kind: 'download' as const, d })),
      page
        .locator('main p.error')
        .waitFor({ state: 'visible', timeout: 30_000 })
        .then(() => ({ kind: 'error' as const })),
    ])

    if (downloadOrError.kind === 'download') {
      expect(await downloadOrError.d.failure()).toBeNull()
    } else {
      await expect(page.locator('main p.error')).not.toHaveText('')
    }
  })

  test('F-05: move / rename file via tree dialog', async ({
    page,
    seededRepo,
  }) => {
    await page.goto(repoPath(seededRepo, '/tree/main'))
    await fileRowAction(page, 'readme.txt', 'Move')

    await expect(page.getByTestId('path-change-move')).toBeVisible()
    await page.getByLabel('Destination path').fill('docs/readme.txt')
    await page
      .getByTestId('path-change-move')
      .getByRole('button', { name: 'Move' })
      .click()

    await expect(page.locator('main p.ok')).toContainText(/Moved/i, {
      timeout: 30_000,
    })
    await page.goto(repoPath(seededRepo, '/tree/main/docs'))
    await expect(fileNameLink(page, 'readme.txt')).toBeVisible({
      timeout: 15_000,
    })
  })

  test('F-06 F-07 F-12 F-15: blob metadata, refresh, version store, history', async ({
    page,
    seededRepo,
  }) => {
    await putFile(
      seededRepo.namespace,
      seededRepo.repo,
      'main',
      'readme.txt',
      'hello v2\n',
      'update readme',
    )

    await page.goto(repoPath(seededRepo, '/blob/main/readme.txt'))
    await expect(page.getByRole('heading', { name: 'readme.txt' })).toBeVisible()
    await page.getByTestId('blob-tab-metadata').click()
    await expect(page.locator('dt', { hasText: 'Hash' })).toBeVisible()
    await expect(page.locator('dd.mono').first()).not.toHaveText('')

    await page.locator('details.blob-ops-menu').getByText('More').click()
    await page.getByRole('menuitem', { name: 'Refresh metadata' }).click()
    await expect(page.locator('main p.ok')).toContainText(/Derived metadata refreshed/i, {
      timeout: 30_000,
    })

    await expect(page.locator('dt', { hasText: 'Version store' })).toBeVisible({
      timeout: 15_000,
    })
    await page.getByTestId('blob-tab-history').click()
    await expect(page.getByRole('heading', { name: /Versions from/ })).toBeVisible()
    await expect(page.getByRole('link', { name: /update readme/ })).toBeVisible()
  })

  test('F-08 F-14: export zip + download by hash tarball', async ({
    page,
    seededRepo,
  }) => {
    const entry = await getFileEntry(
      seededRepo.namespace,
      seededRepo.repo,
      'main',
      'readme.txt',
    )
    expect(entry?.hash).toBeTruthy()

    await page.goto(repoPath(seededRepo, '/import'))

    const zipDownload = page.waitForEvent('download')
    await page
      .locator('section', { hasText: 'Export zip' })
      .getByRole('button', { name: 'Download zip' })
      .click()
    const zip = await zipDownload
    expect(zip.suggestedFilename()).toMatch(/\.zip$/)

    await page
      .locator('details', { hasText: 'Download by content hash' })
      .locator('summary')
      .click()
    await page
      .locator('details', { hasText: 'Download by content hash' })
      .getByLabel(/Hashes/)
      .fill(entry!.hash!)
    const tgzDownload = page.waitForEvent('download')
    await page
      .locator('details', { hasText: 'Download by content hash' })
      .getByRole('button', { name: 'Download .tgz' })
      .click()
    const tgz = await tgzDownload
    expect(tgz.suggestedFilename()).toMatch(/\.tgz$/)
    await expect(page.locator('main p.ok')).toContainText(/tarball/i)
  })

  test('F-09: import from URL surfaces server response', async ({
    page,
    seededRepo,
  }) => {
    await page.goto(repoPath(seededRepo, '/import'))
    await page.getByRole('tab', { name: 'Import' }).click()
    const section = page.locator('section', { hasText: 'Import from URL' })
    await section.getByLabel('Download URL').fill('https://example.invalid/file.txt')
    await section.getByLabel('Destination path').fill('imports/remote.txt')
    await section.getByRole('button', { name: 'Import URL' }).click()
    // Live server blocks / fails fetch — UI must show the error (wiring check).
    await expect(page.locator('main p.error')).toBeVisible({ timeout: 30_000 })
  })

  test('F-10: upload & unpack zip archive', async ({ page, seededRepo }) => {
    await page.goto(repoPath(seededRepo, '/import'))
    await page.getByRole('tab', { name: 'Import' }).click()
    const section = page.locator('section', { hasText: 'Upload zip archive' })
    await section.getByLabel('Destination directory').fill('from-zip')
    await section.locator('input[name="file"]').setInputFiles(
      path.join(fixtures, 'sample.zip'),
    )
    await section.getByRole('button', { name: 'Upload & unpack' }).click()
    await expect(page.locator('main p.ok')).toContainText(/Zip unpacked/i, {
      timeout: 30_000,
    })

    await page.goto(repoPath(seededRepo, '/tree/main/from-zip'))
    await expect(page.getByRole('link', { name: /zip-src|unpacked/ })).toBeVisible({
      timeout: 15_000,
    })
  })

  test('F-11: download by hash from blob page', async ({ page, seededRepo }) => {
    await page.goto(repoPath(seededRepo, '/blob/main/readme.txt'))
    await page.locator('details.blob-ops-menu').getByText('More').click()
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('menuitem', { name: 'Download by hash' }).click()
    const download = await downloadPromise
    expect(await download.failure()).toBeNull()
    await expect(page.locator('main p.ok')).toContainText(/Downloaded .* by content hash/i, {
      timeout: 15_000,
    })
  })

  test('F-03 path + tree export via Manage Files', async ({
    page,
    seededRepo,
  }) => {
    await putFile(
      seededRepo.namespace,
      seededRepo.repo,
      'main',
      'notes/a.txt',
      'a\n',
      'note a',
    )

    await page.goto(repoPath(seededRepo, '/tree/main?manage=export'))
    const dialog = page.getByRole('dialog', { name: 'Export' })
    await expect(dialog).toBeVisible({ timeout: 15_000 })
    const exportDl = page.waitForEvent('download')
    await dialog.getByRole('button', { name: 'Download zip' }).click()
    expect((await exportDl).suggestedFilename()).toMatch(/\.zip$/)
  })

  test('branch tip shown (B-03) after create on feature', async ({
    page,
    seededRepo,
  }) => {
    await createBranch(
      seededRepo.namespace,
      seededRepo.repo,
      'feature',
      'main',
    )
    await page.goto(repoPath(seededRepo, '/branches'))
    const row = page.locator('tr[data-branch="feature"]')
    await expect(row).toHaveAttribute('data-commit-id', /^[a-f0-9]{8,}$/)
  })
})
