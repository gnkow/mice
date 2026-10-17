import { test as base, expect } from '@playwright/test'
import { createRepo, deleteRepo, uniqueId } from '../helpers/oxenApi'
import { mintSession } from '../helpers/session'

const BASE_URL = process.env.BOXEN_BASE_URL ?? 'http://localhost:5173'
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
    iss: 'boxen-e2e',
  })
}

test.describe('CLI auth via BFF PATs (PLAT-AUTH)', () => {
  test('TC-CLI-01: PAT can call /api on BFF without session cookie', async ({
    page,
  }) => {
    await sessionLogin(page)
    const created = await page.request.post(`${BASE_URL}/auth/tokens`, {
      data: { label: 'e2e-cli' },
    })
    expect(created.ok()).toBeTruthy()
    const body = await created.json()
    const pat = body.token as string
    expect(pat).toMatch(/^boxen_pat_/)

    // Drop cookie session — CLI only sends Bearer
    await page.context().clearCookies()

    const denied = await page.request.get(`${AUTH_URL}/api/version`)
    expect(denied.status()).toBe(401)

    const ok = await page.request.get(`${AUTH_URL}/api/version`, {
      headers: { Authorization: `Bearer ${pat}` },
    })
    expect(ok.ok()).toBeTruthy()
    const version = await ok.json()
    expect(version.oxen_version || version.status).toBeTruthy()
  })

  test('TC-CLI-02: PAT author is injected on write (create via BFF)', async ({
    page,
  }) => {
    const authorName = 'CLI Pat Author'
    const authorEmail = 'cli-pat@author.test'
    await sessionLogin(page, {
      name: authorName,
      email: authorEmail,
      sub: 'cli-pat-author',
    })
    const created = await page.request.post(`${BASE_URL}/auth/tokens`, {
      data: { label: 'write-cli' },
    })
    const { token: pat } = await created.json()
    await page.context().clearCookies()

    const ns = uniqueId('cli-ns')
    const repo = 'repo'
    const create = await page.request.post(`${AUTH_URL}/api/repos`, {
      headers: {
        Authorization: `Bearer ${pat}`,
        'Content-Type': 'application/json',
      },
      data: { namespace: ns, name: repo },
    })
    expect(create.ok()).toBeTruthy()

    // Upload a file through BFF with forged author fields — BFF must overwrite
    const form = new FormData()
    form.append(
      'file',
      new Blob(['hello cli\n'], { type: 'text/plain' }),
      'readme.txt',
    )
    form.append('message', 'cli pat commit')
    form.append('name', 'Forged Name')
    form.append('email', 'forged@evil.test')

    const put = await page.request.put(
      `${AUTH_URL}/api/repos/${encodeURIComponent(ns)}/${encodeURIComponent(repo)}/file/main/readme.txt`,
      {
        headers: { Authorization: `Bearer ${pat}` },
        multipart: {
          file: {
            name: 'readme.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from('hello cli\n'),
          },
          message: 'cli pat commit',
          name: 'Forged Name',
          email: 'forged@evil.test',
        },
      },
    )
    expect(put.ok()).toBeTruthy()
    const putBody = await put.json()
    expect(putBody.commit?.author || putBody.commit?.email).toBeTruthy()
    expect(putBody.commit.author).toBe(authorName)
    expect(putBody.commit.email).toBe(authorEmail)

    await deleteRepo(ns, repo)
  })

  test('TC-CLI-03: revoked PAT is rejected', async ({ page }) => {
    await sessionLogin(page)
    const created = await page.request.post(`${BASE_URL}/auth/tokens`, {
      data: { label: 'revoke-me' },
    })
    const { token: pat, pat: meta } = await created.json()

    const rev = await page.request.delete(
      `${BASE_URL}/auth/tokens/${meta.id}`,
    )
    expect(rev.ok()).toBeTruthy()

    await page.context().clearCookies()
    const res = await page.request.get(`${AUTH_URL}/api/version`, {
      headers: { Authorization: `Bearer ${pat}` },
    })
    expect(res.status()).toBe(401)
  })

  test('TC-CLI-04: Settings UI can create a CLI token', async ({ page }) => {
    await sessionLogin(page)
    await page.goto('/settings')
    await expect(
      page.getByRole('heading', { name: 'CLI tokens' }),
    ).toBeVisible()
    const label = uniqueId('ui-cli')
    await page.getByLabel('Token label').fill(label)
    await page.getByRole('button', { name: 'Create token' }).click()
    await expect(page.getByText(/Copy this token now/i)).toBeVisible()
    const shown = page.locator('.flash-warn pre.settings-code')
    await expect(shown).toContainText('boxen_pat_')
    await expect(
      page.getByRole('listitem').filter({ hasText: label }),
    ).toBeVisible()
  })

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
    await expect(cloneBox.getByText(/boxen login/i)).toBeVisible()
    await expect(cloneBox.getByText(/boxen clone/i)).toBeVisible()
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
    expect(info.loginExample).toMatch(/boxen login/)
    expect(info.cloneExample).toMatch(/boxen clone/)
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
      email: 'device-login@boxen.local',
      sub: 'device-login',
    })

    await page.goto(`/cli/device?user_code=${encodeURIComponent(started.user_code)}`)
    await expect(page.getByRole('heading', { name: 'Authorize CLI' })).toBeVisible()
    await expect(page.getByText(started.user_code)).toBeVisible()
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
    const pat = (body.token || body.access_token) as string
    expect(pat).toMatch(/^boxen_pat_/)

    await page.context().clearCookies()
    const api = await page.request.get(`${AUTH_URL}/api/version`, {
      headers: { Authorization: `Bearer ${pat}` },
    })
    expect(api.ok()).toBeTruthy()

    const who = await page.request.get(`${AUTH_URL}/auth/cli/whoami`, {
      headers: { Authorization: `Bearer ${pat}` },
    })
    expect(who.ok()).toBeTruthy()
    const me = await who.json()
    expect(me.user.email).toBe('device-login@boxen.local')

    const logout = await page.request.post(`${AUTH_URL}/auth/cli/logout`, {
      headers: { Authorization: `Bearer ${pat}` },
      data: {},
    })
    expect(logout.ok()).toBeTruthy()

    const denied = await page.request.get(`${AUTH_URL}/api/version`, {
      headers: { Authorization: `Bearer ${pat}` },
    })
    expect(denied.status()).toBe(401)
  })
})
