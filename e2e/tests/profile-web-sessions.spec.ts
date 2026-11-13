import { expect } from '@playwright/test'
import { cleanTest as base } from '../fixtures'
import { uniqueId } from '../helpers/oxenApi'
import { mintSession } from '../helpers/session'

/** Web sessions list on Profile — adjacent to sign-out-everywhere (issue 03). */
const test = base

test.describe('profile web sessions list (PLAT-AUTH)', () => {
  test('TC-AUTH-WS-01: Profile lists active web sessions after mintSession', async ({
    page,
    browser,
  }) => {
    const sub = uniqueId('web-sess')
    const identity = {
      name: 'Web Sess Spec',
      email: `${sub}@mice.local`,
      sub,
      iss: 'mice-e2e' as const,
    }
    await mintSession(page, identity)

    const other = await browser.newContext()
    const otherPage = await other.newPage()
    await mintSession(otherPage, identity)

    await page.goto('/profile')
    await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible()

    const section = page.getByTestId('web-sessions-list')
    await expect(section.getByRole('heading', { name: /Web Sessions/ })).toBeVisible()
    await expect(section).toContainText(/2 active/)
    await expect(
      section.getByRole('button', { name: /Sign out session/ }).first(),
    ).toBeVisible()

    await other.close()
  })

  test('TC-AUTH-WS-02: Profile can revoke another browser session', async ({
    page,
    browser,
  }) => {
    const sub = uniqueId('web-revoke')
    const identity = {
      name: 'Web Revoke Spec',
      email: `${sub}@mice.local`,
      sub,
      iss: 'mice-e2e' as const,
    }
    await mintSession(page, identity)

    const other = await browser.newContext()
    const otherPage = await other.newPage()
    await mintSession(otherPage, identity)

    await page.goto('/profile')
    const section = page.getByTestId('web-sessions-list')
    await expect(section).toContainText(/2 active/)

    // Sessions are ordered by start time; revoke the newest (other browser), not this one.
    page.once('dialog', (d) => void d.accept())
    await section.getByRole('button', { name: /Sign out session/ }).last().click()

    await expect(section).toContainText(/1 active/, { timeout: 15_000 })
    await other.close()
  })
})
