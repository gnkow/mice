import { test, expect, repoPath } from '../fixtures'
import { createBranch, putFile } from '../helpers/oxenApi'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const wsNote = path.join(__dirname, '../fixtures/ws-note.txt')

test.describe('workspaces & merge (W/M)', () => {
  test('W-01 W-02 W-09 W-13: create workspace, stage file, commit', async ({
    page,
    seededRepo,
  }) => {
    await page.goto(repoPath(seededRepo, '/workspaces'))
    await expect(page.getByRole('heading', { name: 'Workspaces' })).toBeVisible()

    await page.getByRole('button', { name: 'New workspace' }).click()
    const dialog = page.getByRole('dialog', { name: 'New workspace' })
    await dialog.getByLabel('Name').fill('e2e-ws')
    await dialog.getByRole('button', { name: 'Create workspace' }).click()

    await expect(page).toHaveURL(/\/workspaces\/[^/]+$/, { timeout: 30_000 })
    await expect(page.getByRole('heading', { name: 'e2e-ws' })).toBeVisible()

    await page.getByRole('tab', { name: 'Stage' }).click()
    const uploadSection = page.locator('section', { hasText: 'Upload file' })
    await uploadSection.locator('input[name="file"]').setInputFiles(wsNote)
    await uploadSection.getByRole('button', { name: 'Stage upload' }).click()

    await expect(page.locator('main p.ok')).toHaveText(/Staged ws-note\.txt/, {
      timeout: 30_000,
    })
    await expect(page.locator('code', { hasText: 'ws-note.txt' })).toBeVisible()

    await page.getByRole('tab', { name: 'Commit' }).click()
    const commitSection = page.locator('section', {
      hasText: 'Commit & merge into branch',
    })
    await commitSection.getByLabel('Commit message').fill('workspace commit via e2e')
    await commitSection.getByRole('button', { name: 'Commit workspace' }).click()

    await expect(page.locator('main p.ok')).toContainText(/Committed/i, {
      timeout: 30_000,
    })
  })

  test('M-01 M-02: mergeable check and merge feature into main', async ({
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
      'from-feature.txt',
      'merge me\n',
      'feature commit',
    )

    await page.goto(repoPath(seededRepo, '/merge?base=main&head=feature'))
    await expect(page.getByRole('heading', { name: 'Merge', exact: true })).toBeVisible()
    await expect(page.getByText('Mergeable', { exact: true })).toBeVisible({
      timeout: 30_000,
    })

    await page.getByRole('button', { name: 'Merge feature → main' }).click()
    await expect(page.locator('main p.ok')).toContainText(/Merged/i, {
      timeout: 30_000,
    })
  })
})

