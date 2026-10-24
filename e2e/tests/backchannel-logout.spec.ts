import { test as base, expect } from '@playwright/test'
import { signInWithSsoViaKeycloak } from '../helpers/keycloak'

const test = base

test.describe('back-channel logout (PLAT-AUTH)', () => {
  test('TC-AUTH-BCL-01: ending the IdP session ends the Mice Session', async ({ page }) => {
    await signInWithSsoViaKeycloak(page)
    const before = await page.request.get('/auth/me')
    expect((await before.json()).authenticated).toBe(true)

    // Cut-offs have one-second resolution.
    await page.waitForTimeout(1100)
    const kc = await page.context().newPage()
    await kc.goto('http://localhost:8180/realms/mice/protocol/openid-connect/logout')
    await kc.locator('#kc-logout').click()
    await expect(kc.locator('body')).toBeVisible()

    await expect
      .poll(async () => (await (await page.request.get('/auth/me')).json()).authenticated, { timeout: 15_000 })
      .toBe(false)
  })
})
