import { expect } from '@playwright/test'
import { cleanTest as base } from '../fixtures'

const test = base

/** SAML IdP (realm partner-saml) brokered through the mice Keycloak realm; the BFF stays OIDC-only. */
test.describe('SAML via Keycloak brokering (PLAT-AUTH)', () => {
  test('TC-AUTH-SAML-01: sign in through the brokered SAML IdP', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('link', { name: 'Sign in with SSO' }).click()
    await page.getByRole('link', { name: /Partner \(SAML\)/ }).click()
    await page.locator('#username').fill('partner')
    await page.locator('#password').fill('partner')
    await page.locator('#kc-login').click()
    await expect(page).toHaveURL(/localhost:5173/, { timeout: 30_000 })
    await expect(page.locator('header.topbar')).toBeVisible({ timeout: 20_000 })
    const me = await page.request.get('/auth/me')
    const body = (await me.json()) as { authenticated: boolean; user: { email: string; name: string } }
    expect(body.authenticated).toBe(true)
    expect(body.user.email).toBe('partner@partner.example')
    expect(body.user.name).toContain('Partner')
  })
})
