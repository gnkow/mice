import { expect } from '@playwright/test'
import { cleanTest as base } from '../fixtures'
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

let deviceStartSeq = 0

async function startDevice(
  request: import('@playwright/test').APIRequestContext,
  opts?: { deviceName?: string; forwardedFor?: string },
) {
  deviceStartSeq += 1
  // Unique client IP per start so device-flow rate limits do not trip mid-suite.
  const forwardedFor =
    opts?.forwardedFor ?? `203.0.113.${(deviceStartSeq % 200) + 1}`
  const start = await request.post(`${AUTH_URL}/auth/cli/device/start`, {
    data: { device_name: opts?.deviceName ?? 'e2e-device' },
    headers: {
      'X-Forwarded-For': forwardedFor,
    },
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
  test('TC-CLI-08b: admin without approve sees login-status permission warn', async ({
    page,
  }) => {
    await mintSession(page, {
      name: 'Admin No Approve',
      email: 'admin-no-approve@mice.local',
      sub: `admin-cli-${Date.now()}`,
      iss: 'mice-e2e',
      role: 'admin',
    })
    await page.goto('/cli/device')
    await expect(page.getByRole('heading', { name: 'Authorize CLI' })).toBeVisible()
    const warn = page.getByTestId('cli-device-permission')
    await expect(warn).toBeVisible()
    await expect(warn.getByRole('heading', { name: 'Approval not available' })).toBeVisible()
    await expect(warn.getByText(/You need permission to approve command-line login/i)).toBeVisible()
    await expect(warn.getByText(/separation of duties/i)).toBeVisible()
  })

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
    const statusCard = page.getByTestId('cli-device-status')
    await expect(statusCard.locator('code.cli-device-code', { hasText: started.user_code })).toBeVisible()
    await expect(page.getByText(/Waiting for your approval/i)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Look up', exact: true })).toHaveCount(0)

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

  test('TC-CLI-09b: Look up reloads the same code and change-code restores the form', async ({
    page,
  }) => {
    const started = await startDevice(page.request)
    await sessionLogin(page)

    await page.goto(`/cli/device?user_code=${encodeURIComponent(started.user_code)}`)
    await expect(page.getByTestId('cli-device-status')).toBeVisible()
    await expect(page.getByText(/Waiting for your approval/i)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Look up', exact: true })).toHaveCount(0)

    await page.getByRole('button', { name: 'Change' }).click()
    await expect(page.getByRole('button', { name: 'Look up', exact: true })).toBeVisible()
    await page.getByLabel('Device code').fill(started.user_code)
    await page.getByRole('button', { name: 'Look up', exact: true }).click()
    await expect(page.getByText(/Waiting for your approval/i)).toBeVisible()
    await expect(page.locator('code.cli-device-code', { hasText: started.user_code })).toBeVisible()
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
      { data: { user_code: started.user_code, confirmation: 'APPROVE' } },
    )
    expect(approve.ok()).toBeTruthy()

    await page.waitForTimeout(4500)
    const poll = await page.request.post(`${AUTH_URL}/auth/cli/device/poll`, {
      data: { device_code: started.device_code },
    })
    expect(poll.ok()).toBeTruthy()
    const body = await poll.json()
    expect(body.status).toBe('approved')
    expect(body.token).toMatch(/^mice_cli_/)
    expect(body.user.email).toBe('api-approve@mice.local')
  })

  test('TC-CLI-15: unknown user code shows error on device page', async ({
    page,
  }) => {
    await sessionLogin(page)
    await page.goto('/cli/device?user_code=ZZZZ-ZZZZ')
    await expect(page.getByRole('heading', { name: 'Authorize CLI' })).toBeVisible()
    await expect(page.getByRole('alert')).toContainText(/Unknown user code/i)
  })

  test('TC-CLI-16: hashed IP suffix and device name are clearly labeled', async ({
    page,
  }) => {
    const deviceName = 'e2e-cli-laptop'
    const started = await startDevice(page.request, {
      deviceName,
      forwardedFor: '203.0.113.44',
    })
    await sessionLogin(page)

    await page.goto(
      `/cli/device?user_code=${encodeURIComponent(started.user_code)}`,
    )
    await expect(page.getByRole('heading', { name: 'Authorize CLI' })).toBeVisible()
    await expect(
      page.locator('code.mono', { hasText: started.user_code }),
    ).toBeVisible()

    const status = await page.request.get(
      `${AUTH_URL}/auth/cli/device/status?user_code=${encodeURIComponent(started.user_code)}`,
    )
    expect(status.ok()).toBeTruthy()
    const body = (await status.json()) as {
      requestHashedIp?: string
      deviceName?: string
    }
    expect(body.requestHashedIp).toMatch(/^[0-9a-f]{4}$/i)
    expect(body.deviceName).toBe(deviceName)

    await expect(page.getByText('Request fingerprint', { exact: true })).toBeVisible()
    const suffix = page.getByTestId('cli-request-fingerprint')
    await expect(suffix).toBeVisible()
    await expect(suffix).toHaveText(body.requestHashedIp!)
    await expect(page.getByLabel('Device name')).toHaveValue(deviceName)
  })

  test('TC-CLI-16b: device name is editable before approve', async ({ page }) => {
    const started = await startDevice(page.request, {
      deviceName: 'original-hostname',
      forwardedFor: '198.51.100.20',
    })
    await sessionLogin(page)
    await page.goto(
      `/cli/device?user_code=${encodeURIComponent(started.user_code)}`,
    )
    const name = page.getByLabel('Device name')
    await expect(name).toHaveValue('original-hostname')
    await name.fill('renamed-laptop')
    await expect(page.getByTestId('cli-request-fingerprint')).toBeVisible()

    await page.getByLabel(/Type Approve/i).fill('Approve')
    await page.getByRole('button', { name: 'Approve' }).click()
    await expect(
      page.getByText(/Approved\. Return to your terminal/i),
    ).toBeVisible()

    const status = await page.request.get(
      `${AUTH_URL}/auth/cli/device/status?user_code=${encodeURIComponent(started.user_code)}`,
    )
    expect(status.ok()).toBeTruthy()
    const body = (await status.json()) as { deviceName?: string; status?: string }
    expect(body.status).toBe('approved')
    expect(body.deviceName).toBe('renamed-laptop')
  })

  test('TC-CLI-25: phishing security warning is visible before approve', async ({
    page,
  }) => {
    const started = await startDevice(page.request, {
      deviceName: 'e2e-phish-check',
      forwardedFor: '198.51.100.10',
    })
    await sessionLogin(page)

    await page.goto(
      `/cli/device?user_code=${encodeURIComponent(started.user_code)}`,
    )
    await expect(page.getByRole('heading', { name: 'Authorize CLI' })).toBeVisible()
    await expect(page.getByText(/Waiting for your approval/i)).toBeVisible()

    const warning = page.locator('#cli-device-security-warning')
    await expect(warning).toBeVisible()
    await expect(warning).toContainText(/Security warning/i)
    await expect(warning).toContainText(/Only approve a code you started/i)
    await expect(warning).toContainText(/5 per 10 minutes/i)
  })

  test('TC-CLI-24: approve 429 shows too-many-attempts alert', async ({
    page,
  }) => {
    const started = await startDevice(page.request)
    await sessionLogin(page)

    await page.route('**/auth/cli/device/approve', async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        json: { error: 'Too many attempts. Wait about 10 minutes, then try again.', limit: 5 },
      })
    })

    await page.goto(
      `/cli/device?user_code=${encodeURIComponent(started.user_code)}`,
    )
    await expect(page.getByRole('heading', { name: 'Authorize CLI' })).toBeVisible()
    await page.getByLabel(/Type Approve/i).fill('Approve')
    await page.getByRole('button', { name: 'Approve' }).click()

    const alert = page.getByRole('alert')
    await expect(alert).toBeVisible()
    await expect(alert).toContainText(/too many attempts/i)
  })

  test('TC-CLI-43: Approve stays disabled until confirmation matches', async ({
    page,
  }) => {
    const started = await startDevice(page.request)
    await sessionLogin(page)

    await page.goto(
      `/cli/device?user_code=${encodeURIComponent(started.user_code)}`,
    )
    await expect(page.getByRole('heading', { name: 'Authorize CLI' })).toBeVisible()
    await expect(page.getByText(/Waiting for your approval/i)).toBeVisible()

    const approve = page.getByRole('button', { name: 'Approve' })
    const confirm = page.getByLabel(/Type Approve/i)
    await expect(approve).toBeDisabled()

    await confirm.fill('NOPE')
    await expect(approve).toBeDisabled()
    await expect(confirm).toHaveAttribute('aria-invalid', 'true')

    await confirm.fill('Approve')
    await expect(approve).toBeEnabled()
    await expect(confirm).not.toHaveAttribute('aria-invalid', 'true')

    await approve.click()
    await expect(
      page.getByText(/Approved\. Return to your terminal/i),
    ).toBeVisible()
  })
})
