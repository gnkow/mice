import { test as base, expect } from '@playwright/test'
import { mintSession } from '../helpers/session'

const BASE_URL = process.env.MICE_BASE_URL ?? 'http://localhost:5173'

const test = base

test.describe('sign out everywhere (PLAT-AUTH)', () => {
  test('TC-AUTH-SOE-01: Profile button ends Sessions, keeps PATs by default', async ({
    page,
    browser,
  }) => {
    const identity = { name: 'Soe Spec', email: 'soe@mice.local', sub: 'soe-spec', iss: 'mice-e2e' }
    await mintSession(page, identity)
    const other = await browser.newContext()
    const otherPage = await other.newPage()
    await mintSession(otherPage, identity)

    const created = await page.request.post(`${BASE_URL}/auth/tokens`, {
      headers: { origin: BASE_URL },
      data: { label: 'soe-pat' },
    })
    expect(created.ok()).toBeTruthy()
    const { token } = (await created.json()) as { token: string }

    // Cut-offs have one-second resolution; wait so the new Session post-dates nothing.
    await page.waitForTimeout(1100)
    await page.goto('/profile')
    page.once('dialog', (d) => void d.accept())
    await page.getByRole('button', { name: 'Sign out everywhere' }).click()
    await expect(page.getByText('Signed out everywhere.')).toBeVisible()

    const stale = await other.request.get(`${BASE_URL}/auth/me`)
    expect((await stale.json()).authenticated).toBe(false)
    const viaPat = await page.request.get(`${BASE_URL}/api/version`, {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(viaPat.status()).not.toBe(401)
    await other.close()
  })
})
