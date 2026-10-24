import {
  test,
  expect,
  repoPath,
  acceptConfirmModal,
  openAccountMenu,
  repoTitle,
  fileRowAction,
  fileNameLink,
} from '../fixtures'
import { deleteRepo } from '../helpers/oxenApi'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const sampleTxt = path.join(__dirname, '../fixtures/sample.txt')

test.describe('smoke (P/N/R/F)', () => {
  test('P-01 P-02: home connects and Settings probe works', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible()
    await expect(page.locator('.site-footer')).toContainText(/Server v/)
    await openAccountMenu(page)
    await page
      .locator('.profile-menu-panel')
      .getByRole('link', { name: 'Settings' })
      .click()
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
    await page.getByRole('button', { name: 'Test connection' }).click()
    await expect(page.locator('main').getByText(/Connected · oxen-server v/)).toBeVisible()
  })

  test('R-02 N-01 N-02 R-03: create repo via UI and open it', async ({
    page,
    emptyRepo,
  }) => {
    const ns = `${emptyRepo.namespace}-ui`
    const name = 'from-ui'

    await page.goto('/repos/new')
    const nsSelect = page.getByRole('combobox', { name: 'Namespace' })
    // Wait until oxen/AuthZ lists hydrate (effect may reset the default choice).
    await expect(nsSelect.locator('option').filter({ hasText: 'New namespace…' })).toBeAttached()
    await expect
      .poll(async () => nsSelect.locator('option').count())
      .toBeGreaterThan(1)
    await nsSelect.selectOption({ label: 'New namespace…' })
    await expect(page.getByLabel('New namespace name')).toBeVisible()
    await page.getByLabel('New namespace name').fill(ns)
    await page.getByLabel('Name', { exact: true }).fill(name)
    await page.getByLabel('Description').fill('e2e created')
    await page.getByRole('button', { name: 'Create repository' }).click()

    await expect(page).toHaveURL(new RegExp(`/n/${ns}/r/${name}/tree/main`))
    await expect(repoTitle(page, name)).toBeVisible()

    await page.goto(`/namespaces?q=${encodeURIComponent(ns)}`)
    await expect(page.getByRole('link', { name: ns, exact: true })).toBeVisible()
    await page.getByRole('link', { name: ns, exact: true }).first().click()
    await expect(
      page.locator('.card-list').getByRole('link', {
        name: new RegExp(`^${name}\\b`),
      }),
    ).toBeVisible()

    await deleteRepo(ns, name)
  })

  test('TC-R-01: list repositories on namespace page', async ({
    page,
    seededRepo,
  }) => {
    await page.goto(`/n/${encodeURIComponent(seededRepo.namespace)}`)
    await expect(
      page.getByRole('heading', { name: seededRepo.namespace }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Repositories' }),
    ).toBeVisible()
    await expect(
      page.locator('.card-list').getByRole('link', {
        name: new RegExp(`^${seededRepo.repo}\\b`),
      }),
    ).toBeVisible()
  })

  test('F-01 F-02 F-03: upload file, browse tree, open blob', async ({
    page,
    emptyRepo,
  }) => {
    await page.goto(repoPath(emptyRepo, '/tree/main'))
    await expect(repoTitle(page, emptyRepo.repo)).toBeVisible()
    await expect(page.getByText('This repository is empty.')).toBeVisible()
    await expect(page.getByText(/Could not find path/i)).toHaveCount(0)

    await page.goto(repoPath(emptyRepo, '/tree/main?manage=upload'))
    const dialog = page.getByRole('dialog', { name: 'Upload' })
    await expect(dialog).toBeVisible({ timeout: 15_000 })
    await dialog.getByLabel('Commit message').fill('add sample.txt')
    await dialog.locator('input[name="file"]').setInputFiles(sampleTxt)
    await dialog.getByRole('button', { name: 'Upload' }).click()

    await expect(fileNameLink(page, 'sample.txt')).toBeVisible({
      timeout: 30_000,
    })

    await fileNameLink(page, 'sample.txt').click()
    await expect(page).toHaveURL(/\/blob\/main\/sample\.txt/)
    await expect(page.getByText('uploaded via playwright')).toBeVisible()
  })

  test('F-04 R-04: delete file then delete repository', async ({
    page,
    seededRepo,
  }) => {
    await page.goto(repoPath(seededRepo, '/tree/main'))
    await expect(fileNameLink(page, 'readme.txt')).toBeVisible()

    await fileRowAction(page, 'readme.txt', 'Delete')
    await acceptConfirmModal(page)

    // Deleted paths stay visible as hint rows until the next commit clears them.
    await expect(
      page.locator('a.file-name-link:not(.file-name-deleted)', {
        hasText: /^readme\.txt$/,
      }),
    ).toHaveCount(0, { timeout: 30_000 })
    await expect(page.getByTestId('file-row-deleted')).toContainText(
      'readme.txt',
    )

    await page
      .locator('nav.repo-nav')
      .getByRole('link', { name: 'Settings', exact: true })
      .click()
    await page.getByRole('button', { name: 'Delete repository' }).click()
    await acceptConfirmModal(page, seededRepo.repo)
    await expect(page).toHaveURL(/\/repositories\/?$/)
  })
})
