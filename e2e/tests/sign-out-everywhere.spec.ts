import { expect } from '@playwright/test'
import { cleanTest as base } from '../fixtures'
import { mintSession } from '../helpers/session'

const BASE_URL = process.env.MICE_BASE_URL ?? 'http://localhost:5173'

const test = base

test.describe('sign out everywhere (PLAT-AUTH)', () => {
  test('TC-AUTH-SOE-01: Profile button ends all Sessions', async ({
    page,
    browser,
  }) => {
    const identity = { name: 'Soe Spec', email: 'soe@mice.local', sub: 'soe-spec', iss: 'mice-e2e' }
    await mintSession(page, identity)
    const other = await browser.newContext()
    const otherPage = await other.newPage()
    await mintSession(otherPage, identity)

    // Cut-offs have one-second resolution; wait so the new Session post-dates nothing.
    await page.waitForTimeout(1100)
    await page.goto('/profile')
    page.once('dialog', (d) => void d.accept())
    await page.getByRole('button', { name: 'Sign out everywhere' }).click()
    await expect(page.getByText('Signed out everywhere.')).toBeVisible()

    const stale = await other.request.get(`${BASE_URL}/auth/me`)
    expect((await stale.json()).authenticated).toBe(false)
    await other.close()
  })
})
