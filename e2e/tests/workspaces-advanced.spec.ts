import { test, expect, repoPath, acceptConfirmModal } from '../fixtures'
import { createWorkspace, putFile } from '../helpers/oxenApi'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const wsNote = path.join(__dirname, '../fixtures/ws-note.txt')

test.describe('workspaces advanced (W-03–W-12)', () => {
  test('W-03 W-06 W-08 W-10 W-11: detail, unstage, preview, stage delete', async ({
    page,
    seededRepo,
  }) => {
    const ws = await createWorkspace(
      seededRepo.namespace,
      seededRepo.repo,
      'main',
      'adv-ws',
    )

    await page.goto(
      repoPath(seededRepo, `/stages/${encodeURIComponent(ws.id)}`),
    )
    await expect(page.getByRole('heading', { name: 'adv-ws' })).toBeVisible()
    await expect(
      page.locator('.workspace-meta-row code[title]').first(),
    ).toHaveAttribute('title', ws.id)

    const upload = page.locator('section', { hasText: 'Upload file' })
    await upload.locator('input[name="file"]').setInputFiles(wsNote)
    await upload.getByRole('button', { name: 'Stage upload' }).click()
    await expect(page.locator('main .flash-success')).toContainText(/Staged/i, {
      timeout: 30_000,
    })

    await page.getByRole('button', { name: 'Preview' }).click()
    await expect(page.locator('pre.code-preview')).toContainText(/staged in workspace/i, {
      timeout: 15_000,
    })

    await page.getByRole('button', { name: 'Unstage' }).first().click()
    await expect(page.getByText('Nothing staged.')).toBeVisible({
      timeout: 30_000,
    })

    await page
      .locator('section', { hasText: 'Stage removal' })
      .getByLabel('Path')
      .fill('readme.txt')
    await page
      .locator('section', { hasText: 'Stage removal' })
      .getByRole('button', { name: 'Stage delete' })
      .click()
    await expect(page.locator('main .flash-success')).toHaveText(/Staged removal of readme\.txt/, {
      timeout: 30_000,
    })
  })

  test('W-04 W-05 W-07 W-12: filter changes, mergeability, delete, clear all', async ({
    page,
    seededRepo,
  }) => {
    await putFile(
      seededRepo.namespace,
      seededRepo.repo,
      'main',
      'notes/x.txt',
      'x\n',
      'notes',
    )
    const ws = await createWorkspace(
      seededRepo.namespace,
      seededRepo.repo,
      'main',
      'clear-me',
    )

    await page.goto(
      repoPath(seededRepo, `/stages/${encodeURIComponent(ws.id)}`),
    )

    const upload = page.locator('section', { hasText: 'Upload file' })
    await upload.getByLabel('Directory').fill('notes')
    await upload.locator('input[name="file"]').setInputFiles(wsNote)
    await upload.getByRole('button', { name: 'Stage upload' }).click()
    await expect(page.locator('code', { hasText: /ws-note/ })).toBeVisible({
      timeout: 30_000,
    })

    await page.getByPlaceholder(/Filter by directory/).fill('notes')
    await page.getByRole('button', { name: 'Filter' }).click()
    await expect(page.getByText(/Showing under/)).toBeVisible()

    await expect(page.getByText(/Mergeable into main/i)).toBeVisible()

    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await acceptConfirmModal(page, 'clear-me')
    await expect(page).toHaveURL(/\/stages$/, { timeout: 30_000 })

    // recreate two workspaces, then delete each from its detail page
    // (bulk "Clear all" was removed from the UI)
    for (const name of ['to-clear-a', 'to-clear-b']) {
      await page.getByRole('button', { name: 'New stage' }).click()
      const dialog = page.getByRole('dialog', { name: 'New stage' })
      await dialog.getByLabel('Name').fill(name)
      await dialog.getByRole('button', { name: 'Create stage' }).click()
      await expect(page).toHaveURL(/\/stages\/[^/]+$/)
      await page.goto(repoPath(seededRepo, '/stages'))
    }
    await expect(page.getByRole('link', { name: 'to-clear-a', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'to-clear-b', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Clear all' })).toHaveCount(0)

    for (const name of ['to-clear-a', 'to-clear-b']) {
      await page.getByRole('link', { name: new RegExp(name) }).first().click()
      // The confirm word comes from the loaded stage name, so wait for it.
      await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
      await page.getByRole('button', { name: 'Delete', exact: true }).click()
      await acceptConfirmModal(page, name)
      await expect(page).toHaveURL(/\/stages$/, { timeout: 30_000 })
    }
    await expect(page.getByText('No stages yet.')).toBeVisible({
      timeout: 30_000,
    })
  })
})
