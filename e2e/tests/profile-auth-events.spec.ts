import { expect } from '@playwright/test'
import { cleanTest as base } from '../fixtures'
import { uniqueId } from '../helpers/oxenApi'
import { mintSession } from '../helpers/session'

const BASE_URL = process.env.MICE_BASE_URL ?? 'http://localhost:5173'

/** Security Activity on Profile after logout (issue 05). */
const test = base

test.describe('profile auth event log (PLAT-AUTH)', () => {
  test('TC-AUTH-AEL-01: Profile shows auth events after logout', async ({ page }) => {
    const sub = uniqueId('auth-events')
    const identity = {
      name: 'Auth Events Spec',
      email: `${sub}@mice.local`,
      sub,
      iss: 'mice-e2e' as const,
    }
    await mintSession(page, identity)

    const logout = await page.request.post(`${BASE_URL}/auth/logout`)
    expect(logout.ok()).toBeTruthy()

    // New session for the same Principal so Profile can load /auth/me/events.
    await mintSession(page, identity)
    await page.goto('/profile')
    await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible()

    const section = page.getByTestId('auth-event-log')
    await expect(section.getByRole('heading', { name: 'Security Activity' })).toBeVisible()
    await expect(section.getByText(/logout/i).first()).toBeVisible({ timeout: 15_000 })
  })
})
