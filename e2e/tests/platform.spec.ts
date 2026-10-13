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
    // Scope by namespace — many e2e fixtures use repo name "repo".
    await expect(
      page.locator(
        `.dash-repo-cards a.repo-summary-card[href*="/n/${encodeURIComponent(seededRepo.namespace)}/"]`,
      ),
    ).toBeVisible({ timeout: 15_000 })
  })

  test('TC-AUTH-01: BFF injects session author on merge commit', async ({
    page,
    seededRepo,
  }) => {
    const authorName = 'E2E Session Author'
    const authorEmail = 'e2e-session@author.test'

    // Override the default fixture session with a known identity
    await page.request.post('/auth/dev-login', {
      data: { name: authorName, email: authorEmail, sub: 'e2e-author', iss: 'boxen-dev' },
    })

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
  })

  test('P-03: break-glass bearer reaches /api without a session cookie', async ({
    page,
  }) => {
    await page.context().clearCookies()
    // App UI requires SSO; break-glass is for automation against the BFF.
    const res = await page.request.get('/api/version', {
      headers: { Authorization: 'Bearer e2e-test-token' },
    })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body.oxen_version || body.status).toBeTruthy()
  })

  test('TC-AUTH-07: unsigned visitor is redirected to login (no app chrome)', async ({
    page,
  }) => {
    await page.context().clearCookies()
    await page.goto('/projects')
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await expect(page.locator('header.topbar')).toHaveCount(0)
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
