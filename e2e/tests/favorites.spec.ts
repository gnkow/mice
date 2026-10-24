import { test, expect } from '../fixtures'

test('favoriting a repo pins it first and lists it on the profile', async ({ page, seededRepo }) => {
  const id = `${seededRepo.namespace}/${seededRepo.repo}`
  await page.goto(`/repositories?q=${encodeURIComponent(seededRepo.namespace)}`)
  const star = page.getByRole('button', { name: `Add ${id} to favorites` })
  await expect(star).toBeEnabled()
  await star.click()
  await expect(page.getByRole('button', { name: `Remove ${id} from favorites` })).toHaveAttribute('aria-pressed', 'true')

  await page.reload()
  await expect(page.getByRole('button', { name: `Remove ${id} from favorites` })).toBeVisible()

  await page.goto('/profile?tab=favorites&type=repo')
  const panel = page.getByRole('tabpanel')
  await expect(panel.getByRole('link', { name: seededRepo.repo })).toBeVisible()
  await expect(page.getByRole('tab', { name: /Repositories/ })).toContainText('1')

  await panel.getByRole('button', { name: `Remove ${id} from favorites` }).click()
  await expect(panel.getByText(/No favorite repositories yet/)).toBeVisible()
})

test('repo header has only the favorite star and jobs list requests pinning', async ({ page, seededRepo }) => {
  await page.goto(`/n/${seededRepo.namespace}/r/${seededRepo.repo}`)
  await expect(page.getByRole('button', { name: /^Star$|Starred/ })).toHaveCount(0)
  await expect(page.locator('.repo-title-bar').getByRole('button', { name: /favorites/ })).toBeVisible()
  const req = page.waitForRequest((r) => r.url().includes('/auth/jobs') && r.url().includes('favorites=first'))
  await page.goto('/jobs')
  await req
})

test('list toolbar has a single Sort by dropdown', async ({ page, seededRepo }) => {
  await page.goto(`/repositories?q=${encodeURIComponent(seededRepo.namespace)}`)
  const select = page.locator('.ns-toolbar').getByLabel('Sort by')
  await expect(select.locator('option')).toHaveText(['Favorites', 'Newest', 'Oldest', 'Name (A–Z)', 'Name (Z–A)'])
  await expect(select).toHaveValue('favorites')
  await select.selectOption('name-desc')
  await page.reload()
  await expect(page.getByLabel('Sort by')).toHaveValue('name-desc')
})

test('scoped listings share the same sort and search toolbar', async ({ page, seededRepo }) => {
  const base = `/n/${encodeURIComponent(seededRepo.namespace)}`
  for (const path of [base, `${base}/r/${seededRepo.repo}/branches`, `${base}/r/${seededRepo.repo}/stages`]) {
    await page.goto(path)
    const toolbar = page.locator('.ns-toolbar')
    await expect(toolbar.getByLabel('Sort by'), path).toBeVisible()
    await expect(toolbar.getByLabel('Search'), path).toBeVisible()
  }
})
