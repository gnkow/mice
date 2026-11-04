import { expect } from '@playwright/test'
import { cleanTest as base } from '../fixtures'
import { createRepo, deleteRepo, uniqueId } from '../helpers/oxenApi'
import { mintSession } from '../helpers/session'

const BASE_URL = process.env.MICE_BASE_URL ?? 'http://localhost:5173'
const AUTH_URL = process.env.AUTH_URL ?? 'http://localhost:8080'

/** CLI/PAT tests manage their own session (no auto-login fixture). */
const test = base

async function sessionLogin(
  page: import('@playwright/test').Page,
  identity?: { name?: string; email?: string; sub?: string },
) {
  await mintSession(page, {
    name: identity?.name,
    email: identity?.email,
    sub: identity?.sub,
    iss: 'mice-e2e',
  })
}

test.describe('CLI auth via device login (PLAT-AUTH)', () => {
  test('TC-CLI-05: Clone box points at BFF remote, not :3001', async ({
    page,
  }) => {
    await sessionLogin(page)
    const ns = uniqueId('clone-ns')
    const repo = 'repo'
    await createRepo(ns, repo)
    await page.goto(`/n/${ns}/r/${repo}/tree/main`)
    const cloneDetails = page.locator('details.clone-dropdown')
    await expect(cloneDetails).toBeVisible({ timeout: 15_000 })
    await cloneDetails.locator('summary').click()
    await expect(cloneDetails).toHaveAttribute('open', '')
    const cloneBox = page.locator('.clone-box')
    await expect(cloneBox.getByText(/mice login/i)).toBeVisible()
    await expect(cloneBox.getByText(/mice clone/i)).toBeVisible()
    await expect(cloneBox).toContainText('localhost:8080')
    const cloneCodes = cloneBox.locator('pre.clone-code')
    await expect(cloneCodes.nth(1)).toContainText('localhost:8080')
    await expect(cloneCodes.nth(1)).not.toContainText(':3001')
    await expect(cloneCodes.nth(2)).not.toContainText(':3001')
    await deleteRepo(ns, repo)
  })

  test('TC-CLI-06: /auth/cli-info documents BFF remote', async ({ request }) => {
    const res = await request.get(`${AUTH_URL}/auth/cli-info`)
    expect(res.ok()).toBeTruthy()
    const info = await res.json()
    expect(info.remote).toMatch(/8080/)
    expect(info.loginExample).toMatch(/mice login/)
    expect(info.cloneExample).toMatch(/mice clone/)
    expect(info.configExample).toMatch(/oxen config --auth/)
  })

  test('TC-CLI-07: device login start → approve → poll → /api works', async ({
    page,
  }) => {
    const start = await page.request.post(`${AUTH_URL}/auth/cli/device/start`, {
      data: {},
    })
    expect(start.ok()).toBeTruthy()
    const started = await start.json()
    expect(started.device_code).toBeTruthy()
    expect(started.user_code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
    expect(started.verification_uri_complete).toContain(started.user_code)

    await sessionLogin(page, {
      name: 'Device Login',
      email: 'device-login@mice.local',
      sub: 'device-login',
    })

    await page.goto(`/cli/device?user_code=${encodeURIComponent(started.user_code)}`)
    await expect(page.getByRole('heading', { name: 'Authorize CLI' })).toBeVisible()
    await expect(page.locator('code.mono', { hasText: started.user_code })).toBeVisible()
    await page.getByPlaceholder('APPROVE').fill('APPROVE')
    await page.getByRole('button', { name: 'Approve' }).click()
    await expect(page.getByText(/Approved/i)).toBeVisible()

    // Poll may need a short wait past slow_down window
    await page.waitForTimeout(4500)
    const poll = await page.request.post(`${AUTH_URL}/auth/cli/device/poll`, {
      data: { device_code: started.device_code },
    })
    expect(poll.ok()).toBeTruthy()
    const body = await poll.json()
    expect(body.status).toBe('approved')
    const accessToken = (body.token || body.access_token) as string
    expect(accessToken).toMatch(/^mice_cli_/)

    await page.context().clearCookies()
    const api = await page.request.get(`${AUTH_URL}/api/version`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(api.ok()).toBeTruthy()

    const who = await page.request.get(`${AUTH_URL}/auth/cli/whoami`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(who.ok()).toBeTruthy()
    const me = await who.json()
    expect(me.user.email).toBe('device-login@mice.local')

    const logout = await page.request.post(`${AUTH_URL}/auth/cli/logout`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: {},
    })
    expect(logout.ok()).toBeTruthy()

    const denied = await page.request.get(`${AUTH_URL}/api/version`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(denied.status()).toBe(401)
  })
})
