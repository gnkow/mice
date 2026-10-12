import { test, expect, repoPath } from '../fixtures'
import { createBranch, listBranches, putFile } from '../helpers/oxenApi'

test.describe('branches advanced (B-04 B-06 C-04)', () => {
  test('B-04: point branch at prior commit via UI', async ({
    page,
    seededRepo,
  }) => {
    const first = (
      await listBranches(seededRepo.namespace, seededRepo.repo)
    ).find((b) => b.name === 'main')!.commit_id

    await putFile(
      seededRepo.namespace,
      seededRepo.repo,
      'main',
      'readme.txt',
      'moved tip\n',
      'move tip',
    )
    const after = (
      await listBranches(seededRepo.namespace, seededRepo.repo)
    ).find((b) => b.name === 'main')!.commit_id
    expect(after).not.toBe(first)

    await createBranch(
      seededRepo.namespace,
      seededRepo.repo,
      'rewind',
      'main',
    )

    await page.goto(repoPath(seededRepo, '/branches'))
    const advanced = page.locator('details.panel', { hasText: 'Power tools' })
    await advanced.locator('summary').click()
    const form = advanced.locator('form').filter({ hasText: 'Commit ID' })
    await form.getByLabel('Branch').fill('rewind')
    await form.getByLabel('Commit ID').fill(first)
    await form.getByRole('button', { name: 'Update tip' }).click()

    await expect
      .poll(async () => {
        const tip = (
          await listBranches(seededRepo.namespace, seededRepo.repo)
        ).find((b) => b.name === 'rewind')?.commit_id
        return tip
      })
      .toBe(first)
  })

  test('B-06: merge commit into branch (push path)', async ({
    page,
    seededRepo,
  }) => {
    await createBranch(
      seededRepo.namespace,
      seededRepo.repo,
      'feature',
      'main',
    )
    const res = await putFile(
      seededRepo.namespace,
      seededRepo.repo,
      'feature',
      'extra.txt',
      'via feature\n',
      'feature commit',
    )
    const clientId = res.commit?.id
    expect(clientId).toBeTruthy()

    const mainTip = (
      await listBranches(seededRepo.namespace, seededRepo.repo)
    ).find((b) => b.name === 'main')!.commit_id

    await page.goto(repoPath(seededRepo, '/branches'))
    const advanced = page.locator('details.panel', { hasText: 'Power tools' })
    await advanced.locator('summary').click()
    const form = advanced.locator('form').filter({ hasText: 'Client commit' })
    await form.locator('select').selectOption('main')
    await form.getByLabel(/Client commit/).fill(clientId!)
    await form.getByLabel(/Server commit/).fill(mainTip)
    await form.getByRole('button', { name: 'Merge into branch' }).click()

    await expect(page.locator('main p.ok')).toContainText(/Branch tip after merge/i, {
      timeout: 30_000,
    })
  })

  test('C-04: commit parents / ancestry on detail page', async ({
    page,
    seededRepo,
  }) => {
    await putFile(
      seededRepo.namespace,
      seededRepo.repo,
      'main',
      'readme.txt',
      'child commit\n',
      'child',
    )

    await page.goto(repoPath(seededRepo, '/commits'))
    await page.getByRole('button', { name: 'All commits' }).click()
    await page.getByRole('link', { name: /^child\b/ }).click()

    await expect(page.getByRole('heading', { name: 'child' })).toBeVisible()
    await expect(page.getByText('Parents')).toBeVisible()
    // Non-root commit should link a parent id
    await expect(page.locator('dd a.mono').first()).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Ancestry' })).toBeVisible()
    await expect(page.locator('.commit-list a').first()).toBeVisible()
  })
})
