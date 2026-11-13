import { expect } from '@playwright/test'
import { cleanTest as base } from '../fixtures'
import { uniqueId } from '../helpers/oxenApi'
import { mintSession } from '../helpers/session'

const AUTH_URL = process.env.AUTH_URL ?? 'http://localhost:8080'

/** Profile CLI device credentials — tickets 07 + 48 (list/revoke, no PAT mint). */
const test = base

async function startDevice(
  request: import('@playwright/test').APIRequestContext,
  opts?: { deviceName?: string },
) {
  const start = await request.post(`${AUTH_URL}/auth/cli/device/start`, {
    data: opts?.deviceName ? { device_name: opts.deviceName } : {},
  })
  expect(start.ok()).toBeTruthy()
  return start.json() as Promise<{
    device_code: string
    user_code: string
  }>
}

test.describe('profile CLI device credentials (PLAT-AUTH)', () => {
  test('TC-AUTH-CLI-07: Profile clarifies short-lived device credentials (no PAT mint)', async ({
    page,
  }) => {
    const sub = uniqueId('cli-cred-copy')
    await mintSession(page, {
      name: 'CLI Cred Copy',
      email: `${sub}@mice.local`,
      sub,
      iss: 'mice-e2e',
    })

    await page.goto('/profile')
    await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible()

    const access = page.getByTestId('profile-cli-access')
    await expect(access).toBeVisible()
    await expect(access.getByText(/short-lived CLI device credentials/i)).toBeVisible()
    await expect(access.getByText(/Personal access tokens are not minted/i)).toBeVisible()

    const section = page.getByTestId('cli-device-credentials')
    await expect(
      section.getByRole('heading', { name: /CLI device credentials/i }),
    ).toBeVisible()
    await expect(section.getByText(/8-hour access token/i)).toBeVisible()
    await expect(section.getByText(/does not mint personal access tokens/i)).toBeVisible()
    await expect(section.getByText(/No active CLI device credentials/i)).toBeVisible()
  })

  test('TC-AUTH-CLI-07b: Profile lists and revokes a device credential after approve', async ({
    page,
  }) => {
    const sub = uniqueId('cli-cred-revoke')
    const identity = {
      name: 'CLI Cred Revoke',
      email: `${sub}@mice.local`,
      sub,
      iss: 'mice-e2e' as const,
    }
    await mintSession(page, identity)

    const started = await startDevice(page.request, { deviceName: 'e2e-profile-cli' })
    const approve = await page.request.post(`${AUTH_URL}/auth/cli/device/approve`, {
      data: { user_code: started.user_code, confirmation: 'APPROVE' },
    })
    expect(approve.ok()).toBeTruthy()

    await page.waitForTimeout(4500)
    const poll = await page.request.post(`${AUTH_URL}/auth/cli/device/poll`, {
      data: { device_code: started.device_code },
    })
    expect(poll.ok()).toBeTruthy()
    const body = await poll.json()
    expect(body.status).toBe('approved')
    expect((body.token || body.access_token) as string).toMatch(/^mice_cli_/)

    await page.goto('/profile')
    const section = page.getByTestId('cli-device-credentials')
    await expect(section).toContainText(/1 active/, { timeout: 15_000 })
    await expect(section.getByText(/Device credential/i)).toBeVisible()

    page.once('dialog', (d) => void d.accept())
    await section.getByRole('button', { name: /Revoke CLI credential/i }).click()
    await expect(section).toContainText(/No active CLI device credentials/i, {
      timeout: 15_000,
    })
  })
})
