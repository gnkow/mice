import { test, expect } from '../fixtures'

test.describe('Sessions UI', () => {
  test('home Sessions tile links to sessions list', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible()
    await page.getByRole('link', { name: /Sessions/ }).click()
    await expect(page).toHaveURL(/\/sessions/)
    await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible()
  })

  test('nav Sessions page can create a mock session', async ({ page }) => {
    const existing = (await (await page.request.get('/auth/sessions')).json()) as { sessions: { id: string; status: string }[] }
    for (const s of existing.sessions.filter((x) => !['stopped', 'destroyed', 'failed'].includes(x.status))) {
      await page.request.delete(`/auth/sessions/${s.id}`)
    }
    await page.goto('/sessions')
    await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible()
    await page.getByRole('button', { name: 'New session' }).click()
    await page
      .getByRole('dialog', { name: 'New session' })
      .getByRole('button', { name: 'Create session' })
      .click()
    // Creation navigates directly to the session detail page.
    await expect(page).toHaveURL(/\/sessions\/[0-9a-f]+/)
    await expect(
      page.getByText(/Ready|Connected|Provisioning/i).first(),
    ).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: 'Connect' })).toBeVisible()
    const id = page.url().split('/sessions/')[1]!.split(/[?#]/)[0]!
    await expect(page.getByRole('tab', { name: 'Workspaces' })).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('tab', { name: 'Metadata' }).click()
    await expect(page.getByRole('tab', { name: 'Metadata' })).toHaveAttribute('aria-selected', 'true')

    await page.goto(`/sessions?q=${id}`)
    await expect(page.getByRole('button', { name: `Connect to session ${id}` })).toBeVisible()
    await expect(page.getByRole('button', { name: `Destroy session ${id}` })).toBeVisible()
    await page.getByRole('button', { name: `Stop session ${id}` }).click()
    await expect(page.getByRole('button', { name: `Stop session ${id}` })).toBeDisabled({ timeout: 15_000 })
    await page.request.delete(`/auth/sessions/${id}`)
  })
})
