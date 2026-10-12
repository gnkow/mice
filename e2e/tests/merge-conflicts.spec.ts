import { test, expect, repoPath } from '../fixtures'
import { createBranch, putFile } from '../helpers/oxenApi'

test.describe('merge conflicts (M-03)', () => {
  test('M-03: conflicting edits show conflicts on merge page', async ({
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
      'main',
      'readme.txt',
      'main side\n',
      'main edit',
    )
    await putFile(
      seededRepo.namespace,
      seededRepo.repo,
      'feature',
      'readme.txt',
      'feature side\n',
      'feature edit',
    )

    await page.goto(repoPath(seededRepo, '/merge?base=main&head=feature'))
    await expect(page.getByRole('heading', { name: 'Merge', exact: true })).toBeVisible()

    await expect(page.getByText('Not mergeable', { exact: true })).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByRole('heading', { name: 'Conflicts', exact: true })).toBeVisible()
  })
})

