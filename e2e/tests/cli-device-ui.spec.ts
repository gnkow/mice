import { test as base, expect } from '@playwright/test'
import { mintSession } from '../helpers/session'

const BASE_URL = process.env.MICE_BASE_URL ?? 'http://localhost:5173'
const AUTH_URL = process.env.AUTH_URL ?? 'http://localhost:8080'

/** Device UI tests manage their own session. */
const test = base

async function sessionLogin(
  page: import('@playwright/test').Page,
  identity?: { name?: string; email?: string; sub?: string },
) {
  await mintSession(page, {
    name: identity?.name ?? 'Device UI',
    email: identity?.email ?? 'device-ui@mice.local',
    sub: identity?.sub ?? 'device-ui',
    iss: 'mice-e2e',
  })
}

async function startDevice(request: import('@playwright/test').APIRequestContext) {
  const start = await request.post(`${AUTH_URL}/auth/cli/device/start`, {
    data: {},
  })
  expect(start.ok()).toBeTruthy()
  return start.json() as Promise<{
    device_code: string
    user_code: string
    verification_uri: string
    verification_uri_complete: string
  }>
}

test.describe('CLI device UI + BFF API (PLAT-AUTH)', () => {
  test('TC-CLI-08: unauthenticated /cli/device redirects to login with next', async ({
    page,
  }) => {
    await page.goto('/cli/device?user_code=ABCD-EFGH')
    await expect(page).toHaveURL(/\/login/)
    expect(page.url()).toContain('next=')
    expect(decodeURIComponent(page.url())).toContain('/cli/device')
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  })

  test('TC-CLI-09: manual code lookup then deny cancels device', async ({
    page,
  }) => {
    const started = await startDevice(page.request)
    await sessionLogin(page)

    await page.goto('/cli/device')
    await expect(page.getByRole('heading', { name: 'Authorize CLI' })).toBeVisible()
    await page.getByLabel('Device code').fill(started.user_code)
    await page.getByRole('button', { name: 'Look up' }).click()
    await expect(page.getByText(started.user_code)).toBeVisible()
    await expect(page.getByText(/waiting for approval/i)).toBeVisible()

    await page.getByRole('button', { name: 'Deny' }).click()
    await expect(
      page.getByText('Denied. The login request was cancelled.'),
    ).toBeVisible()

    await page.waitForTimeout(4500)
    const poll = await page.request.post(`${AUTH_URL}/auth/cli/device/poll`, {
      data: { device_code: started.device_code },
    })
    expect(poll.status()).toBe(400)
    const body = await poll.json()
    expect(body.status).toBe('access_denied')
  })

  test('TC-CLI-10: GET /auth/cli/device redirects to web UI', async ({
    request,
  }) => {
    const res = await request.get(
      `${AUTH_URL}/auth/cli/device?user_code=WXYZ-1234`,
      { maxRedirects: 0 },
    )
    expect([302, 301, 307, 308]).toContain(res.status())
    const loc = res.headers().location ?? ''
    expect(loc).toContain('/cli/device')
    expect(loc).toContain('user_code=WXYZ-1234')
  })

  test('TC-CLI-11: approve without session is 401; status requires session', async ({
    request,
  }) => {
    const started = await startDevice(request)
    const approve = await request.post(`${AUTH_URL}/auth/cli/device/approve`, {
      data: { user_code: started.user_code },
    })
    expect(approve.status()).toBe(401)

    const status = await request.get(
      `${AUTH_URL}/auth/cli/device/status?user_code=${encodeURIComponent(started.user_code)}`,
    )
    expect(status.status()).toBe(401)
  })

  test('TC-CLI-12: whoami / logout require Bearer', async ({ request }) => {
    const who = await request.get(`${AUTH_URL}/auth/cli/whoami`)
    expect(who.status()).toBe(401)
    const logout = await request.post(`${AUTH_URL}/auth/cli/logout`, {
      data: {},
    })
    expect(logout.status()).toBe(401)
  })

  test('TC-CLI-13: poll pending then approved via API (no UI)', async ({
    page,
  }) => {
    const started = await startDevice(page.request)
    await sessionLogin(page, {
      name: 'API Approve',
      email: 'api-approve@mice.local',
      sub: 'api-approve',
    })

    const pending = await page.request.post(`${AUTH_URL}/auth/cli/device/poll`, {
      data: { device_code: started.device_code },
    })
    expect(pending.status()).toBe(400)
    expect((await pending.json()).status).toBe('authorization_pending')

    const approve = await page.request.post(
      `${AUTH_URL}/auth/cli/device/approve`,
      { data: { user_code: started.user_code } },
    )
    expect(approve.ok()).toBeTruthy()

    await page.waitForTimeout(4500)
    const poll = await page.request.post(`${AUTH_URL}/auth/cli/device/poll`, {
      data: { device_code: started.device_code },
    })
    expect(poll.ok()).toBeTruthy()
    const body = await poll.json()
    expect(body.status).toBe('approved')
    expect(body.token).toMatch(/^mice_pat_/)
    expect(body.user.email).toBe('api-approve@mice.local')
  })

  test('TC-CLI-14: Settings documents mice login for day-to-day CLI', async ({
    page,
  }) => {
    await sessionLogin(page)
    await page.goto('/settings')
    await expect(
      page.getByRole('heading', { name: 'CLI tokens' }),
    ).toBeVisible()
    const section = page.locator('section[aria-labelledby="cli-tokens-heading"]')
    await expect(section.locator('pre.settings-code')).toContainText('mice login')
    await expect(section.locator('pre.settings-code')).toContainText(
      'oxen config --auth',
    )
  })

  test('TC-CLI-15: unknown user code shows error on device page', async ({
    page,
  }) => {
    await sessionLogin(page)
    await page.goto('/cli/device?user_code=ZZZZ-ZZZZ')
    await expect(page.getByRole('heading', { name: 'Authorize CLI' })).toBeVisible()
    await expect(page.getByRole('alert')).toContainText(/Unknown user code/i)
  })
})
