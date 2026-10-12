import { test, expect, repoPath } from '../fixtures'
import {
  createBranch,
  getCommit,
  listBranches,
  putFile,
} from '../helpers/oxenApi'

test.describe('platform (P-03 P-04)', () => {
  test('TC-P-04b: empty namespaces state copy', async ({ page }) => {
    await page.route('**/api/namespaces', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'success',
          status_message: 'ok',
          namespaces: [],
        }),
      })
    })

    await page.goto('/')
    await expect(
      page.getByText(
        'No projects yet. Create your first project to start versioning data.',
      ),
    ).toBeVisible({ timeout: 15_000 })
  })

  test('TC-P-04c: Home shows loading then project list', async ({
    page,
    seededRepo,
  }) => {
    await page.route('**/api/namespaces', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue()
        return
      }
      await new Promise((r) => setTimeout(r, 800))
      await route.continue()
    })

    await page.goto('/')
    await expect(page.getByLabel('Loading')).toBeVisible()
    await expect(
      page.locator('.dash-repo-cards').getByRole('link', {
        name: new RegExp(`^${seededRepo.repo}\\b`),
      }),
    ).toBeVisible({ timeout: 15_000 })
  })

  test('TC-SET-01: Settings author used on merge commit', async ({
    page,
    seededRepo,
  }) => {
    const authorName = 'E2E Merge Author'
    const authorEmail = 'e2e-merge@author.test'

    await page.goto('/settings')
    await page.getByLabel('Commit author name').fill(authorName)
    await page.getByLabel('Commit author email').fill(authorEmail)
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Saved.')).toBeVisible()

    await createBranch(
      seededRepo.namespace,
      seededRepo.repo,
      'feature',
      'main',
    )
    // Diverge both sides so merge is not a fast-forward (FF keeps feature author).
    await putFile(
      seededRepo.namespace,
      seededRepo.repo,
      'feature',
      'authored.txt',
      'from feature\n',
      'feature for author',
    )
    await putFile(
      seededRepo.namespace,
      seededRepo.repo,
      'main',
      'on-main.txt',
      'from main\n',
      'main diverges',
    )

    await page.goto(repoPath(seededRepo, '/merge?base=main&head=feature'))
    await expect(
      page.getByRole('heading', { name: 'Merge', exact: true }),
    ).toBeVisible()
    await expect(page.getByText('Mergeable', { exact: true })).toBeVisible({
      timeout: 30_000,
    })
    await page.getByRole('button', { name: 'Merge feature → main' }).click()
    await expect(page.locator('main p.ok')).toContainText(/Merged/i, {
      timeout: 30_000,
    })

    const branches = await listBranches(seededRepo.namespace, seededRepo.repo)
    const main = branches.find((b) => b.name === 'main')
    expect(main?.commit_id).toBeTruthy()
    const commit = await getCommit(
      seededRepo.namespace,
      seededRepo.repo,
      main!.commit_id,
    )
    expect(commit?.author).toBe(authorName)
    expect(commit?.email).toBe(authorEmail)

    // restore defaults for other tests in this worker
    await page.goto('/settings')
    await page.getByLabel('Commit author name').fill('Boxen')
    await page.getByLabel('Commit author email').fill('boxen@localhost')
    await page.getByRole('button', { name: 'Save' }).click()
  })

  test('P-03: bearer token from Settings is sent on API requests', async ({
    page,
  }) => {
    let sawAuth = false
    await page.route('**/api/**', async (route) => {
      const auth = route.request().headers()['authorization']
      if (auth === 'Bearer e2e-test-token') sawAuth = true
      await route.continue()
    })

    await page.goto('/settings')
    await page.getByLabel('Bearer token').fill('e2e-test-token')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Saved.')).toBeVisible()

    await page.getByRole('button', { name: 'Test connection' }).click()
    await expect(page.locator('main').getByText(/Connected · oxen-server v/)).toBeVisible()
    expect(sawAuth).toBe(true)

    // Clear token so later tests are unaffected (same browser context is per-test by default)
    await page.getByLabel('Bearer token').fill('')
    await page.getByRole('button', { name: 'Save' }).click()
  })

  test('P-04: bad API base shows offline / error state', async ({ page }) => {
    await page.goto('/settings')
    await page.getByLabel('API base URL').fill('http://127.0.0.1:9')
    await page.getByRole('button', { name: 'Save' }).click()
    await page.getByRole('button', { name: 'Test connection' }).click()
    await expect(page.getByText(/fail|error|refused|network|Failed/i)).toBeVisible({
      timeout: 15_000,
    })

    await page.goto('/')
    await expect(page.locator('.conn.bad')).toContainText('offline', {
      timeout: 15_000,
    })

    // restore default proxy
    await page.goto('/settings')
    await page.getByLabel('API base URL').fill('')
    await page.getByRole('button', { name: 'Save' }).click()
  })
})
