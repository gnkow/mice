import { test, expect, repoPath, acceptConfirmModal } from '../fixtures'
import { createBranch, createWorkspace, putFile } from '../helpers/oxenApi'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixtures = path.join(__dirname, '../fixtures')

test.describe('compare & DF (D-03–D-07 DF-01–05)', () => {
  test('D-03 D-04: path filter and file-level diff', async ({
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
      'notes/extra.txt',
      'extra\n',
      'add notes',
    )
    await putFile(
      seededRepo.namespace,
      seededRepo.repo,
      'feature',
      'other.txt',
      'other\n',
      'add other',
    )

    await page.goto(
      repoPath(seededRepo, '/compare?base=main&head=feature'),
    )
    await expect(page.getByRole('button', { name: 'notes/extra.txt' })).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByRole('button', { name: 'other.txt' })).toBeVisible()

    const pathInput = page.getByPlaceholder('e.g. data (empty = all)')
    await pathInput.fill('notes')
    await pathInput.press('Enter')
    await expect(page.getByText(/under notes/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'notes/extra.txt' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'other.txt' })).toHaveCount(0)

    await page.getByRole('button', { name: 'notes/extra.txt' }).click()
    await expect(page.getByRole('heading', { name: /File diff|Diff/i })).toBeVisible({
      timeout: 15_000,
    })
  })

  test('D-05 D-06 D-07: DF compare create, reload, rows, delete', async ({
    page,
    seededRepo,
  }) => {
    const csvA = fs.readFileSync(path.join(fixtures, 'table.csv'), 'utf8')
    const csvB = fs.readFileSync(path.join(fixtures, 'table-b.csv'), 'utf8')
    await putFile(
      seededRepo.namespace,
      seededRepo.repo,
      'main',
      'data/people.csv',
      csvA,
      'people a',
      'people.csv',
    )
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
      'data/people.csv',
      csvB,
      'people b',
      'people.csv',
    )

    await page.goto(
      repoPath(
        seededRepo,
        '/df-compare?base=main&head=feature&path=data/people.csv',
      ),
    )
    await page.getByLabel('Left path').fill('data/people.csv')
    await page.getByLabel('Right path').fill('data/people.csv')
    await page.getByLabel('Join keys (comma-separated)').fill('name')
    await page.getByLabel('Compare columns').fill('score')
    await page.getByRole('button', { name: 'Compare', exact: true }).click()

    await expect(page.getByText('Added rows')).toBeVisible({ timeout: 60_000 })
    await page.getByText('compare_id', { exact: true }).click()
    await expect(page.getByText(/compare_id/)).toBeVisible()

    await page.locator('details.more-actions').getByText('Advanced').click()
    await page.getByRole('button', { name: 'Reload' }).click()
    await expect(page.locator('main .flash-success')).toContainText(/reloaded/i, {
      timeout: 30_000,
    })

    await page.getByRole('button', { name: 'Delete compare' }).click()
    await acceptConfirmModal(page, 'DELETE')
    await expect(page.locator('main .flash-success')).toContainText(/Compare deleted/i, {
      timeout: 30_000,
    })
  })

  test('DF-01 DF-02: table page slice + index', async ({ page, seededRepo }) => {
    const csvA = fs.readFileSync(path.join(fixtures, 'table.csv'), 'utf8')
    await putFile(
      seededRepo.namespace,
      seededRepo.repo,
      'main',
      'data/people.csv',
      csvA,
      'people',
      'people.csv',
    )

    await page.goto(repoPath(seededRepo, '/df/main/data/people.csv'))
    await expect(page.getByRole('heading', { name: 'Data frame' })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'alice' })).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.locator('th', { hasText: 'name' })).toBeVisible()

    await page.getByRole('button', { name: 'Index for query' }).click()
    await expect(page.locator('main .flash-success')).toContainText(/Indexing/i, {
      timeout: 30_000,
    })
  })

  test('TC-DF-01b: DF pagination Next / Previous', async ({
    page,
    seededRepo,
  }) => {
    const csv = fs.readFileSync(path.join(fixtures, 'table-large.csv'), 'utf8')
    await putFile(
      seededRepo.namespace,
      seededRepo.repo,
      'main',
      'data/many.csv',
      csv,
      'many rows',
      'many.csv',
    )

    await page.goto(repoPath(seededRepo, '/df/main/data/many.csv'))
    await expect(
      page.getByRole('cell', { name: 'user1', exact: true }),
    ).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('dt', { hasText: 'Page' })).toBeVisible()
    await expect(page.locator('dd', { hasText: /1 \/ [2-9]/ })).toBeVisible()

    await page.getByRole('button', { name: 'Next' }).click()
    await expect(page.locator('dd', { hasText: /2 \/ / })).toBeVisible({
      timeout: 15_000,
    })
    await expect(
      page.getByRole('cell', { name: 'user51', exact: true }),
    ).toBeVisible({ timeout: 15_000 })

    await page.getByRole('button', { name: 'Previous' }).click()
    await expect(page.locator('dd', { hasText: /1 \/ / })).toBeVisible({
      timeout: 15_000,
    })
    await expect(
      page.getByRole('cell', { name: 'user1', exact: true }),
    ).toBeVisible()
  })

  test('DF-04 DF-05: stage schema + column metadata in workspace', async ({
    page,
    seededRepo,
  }) => {
    const csvA = fs.readFileSync(path.join(fixtures, 'table.csv'), 'utf8')
    await putFile(
      seededRepo.namespace,
      seededRepo.repo,
      'main',
      'data/people.csv',
      csvA,
      'people',
      'people.csv',
    )
    const ws = await createWorkspace(
      seededRepo.namespace,
      seededRepo.repo,
      'main',
      'df-meta',
    )

    await page.goto(repoPath(seededRepo, '/df/main/data/people.csv'))
    await expect(page.getByRole('cell', { name: 'alice' })).toBeVisible({
      timeout: 30_000,
    })

    const schemaSection = page.locator('details', {
      hasText: 'Schema metadata (stage)',
    })
    await schemaSection.locator('summary').click()
    await schemaSection.getByLabel('Stage').first().selectOption(ws.id)
    await schemaSection
      .getByLabel('Schema metadata (JSON object)')
      .fill('{"description":"e2e schema"}')
    await schemaSection
      .getByRole('button', { name: 'Stage schema metadata' })
      .click()
    await expect(page.locator('main .flash-success')).toContainText(/Schema metadata staged/i, {
      timeout: 30_000,
    })

    const columnForm = schemaSection.locator('form').filter({
      has: page.getByRole('button', { name: 'Stage column metadata' }),
    })
    await columnForm.locator('select').selectOption('score')
    await columnForm
      .getByLabel('Column metadata (JSON object)')
      .fill('{"description":"e2e column"}')
    await columnForm.getByRole('button', { name: 'Stage column metadata' }).click()
    await expect(page.locator('main .flash-success')).toContainText(/Column metadata/i, {
      timeout: 30_000,
    })
  })
})
