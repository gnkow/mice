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
    await expect(section).toContainText(/2 of 5 active/)
    await expect(section.getByText(/maximum 5/i)).toBeVisible()
    await expect(
      section.getByText(/signing in from another browser may\s+sign out the oldest session/i),
    ).toBeVisible()
    await expect(
      section.getByRole('button', { name: /Sign out session/ }).first(),
    ).toBeVisible()

    await other.close()
  })

  test('TC-AUTH-WS-15: Profile surfaces session cap and eviction note at limit', async ({
    page,
    browser,
  }) => {
    const sub = uniqueId('web-sess-cap')
    const identity = {
      name: 'Web Sess Cap',
      email: `${sub}@mice.local`,
      sub,
      iss: 'mice-e2e' as const,
    }
    await mintSession(page, identity)

    const extras: import('@playwright/test').BrowserContext[] = []
    for (let i = 0; i < 4; i++) {
      const ctx = await browser.newContext()
      extras.push(ctx)
      const p = await ctx.newPage()
      await mintSession(p, identity)
    }

    await page.goto('/profile')
    const section = page.getByTestId('web-sessions-list')
    await expect(section).toContainText(/5 of 5 active/, { timeout: 15_000 })
    await expect(section.getByTestId('web-sessions-cap-note')).toBeVisible()
    await expect(section.getByTestId('web-sessions-cap-note')).toContainText(
      /evict the oldest browser session/i,
    )

    await Promise.all(extras.map((c) => c.close()))
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
    await expect(section).toContainText(/2 of 5 active/)

    // Sessions are ordered by start time; revoke the newest (other browser), not this one.
    page.once('dialog', (d) => void d.accept())
    await section.getByRole('button', { name: /Sign out session/ }).last().click()

    await expect(section).toContainText(/1 of 5 active/, { timeout: 15_000 })
    await other.close()
  })
})
