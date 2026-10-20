import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { openAccountMenu } from '../fixtures'

const KC_USER = process.env.KEYCLOAK_E2E_USER ?? 'mice'
const KC_PASSWORD = process.env.KEYCLOAK_E2E_PASSWORD ?? 'mice'

/** Keycloak username field (varies slightly by theme/version). */
export function keycloakUsername(page: Page) {
  return page.locator(
    '#username, input[name="username"], input#username',
  ).first()
}

export function keycloakPassword(page: Page) {
  return page.locator(
    '#password, input[name="password"], input#password',
  ).first()
}

export function keycloakSubmit(page: Page) {
  return page.locator(
    '#kc-login, button[type="submit"][name="login"], input[type="submit"][name="login"]',
  ).first()
}

/** Expect the browser to be on the Keycloak authorize / login UI. */
export async function expectKeycloakLoginForm(page: Page) {
  await expect(page).toHaveURL(
    /8180|\/realms\/mice\/|openid-connect\/auth/,
    { timeout: 20_000 },
  )
  await expect(keycloakUsername(page)).toBeVisible({ timeout: 20_000 })
  await expect(keycloakPassword(page)).toBeVisible()
}

/** Complete Keycloak username/password and land back in Mice. */
export async function completeKeycloakLogin(
  page: Page,
  user = KC_USER,
  password = KC_PASSWORD,
) {
  await expectKeycloakLoginForm(page)
  await keycloakUsername(page).fill(user)
  await keycloakPassword(page).fill(password)
  await keycloakSubmit(page).click()
  await expect(page).toHaveURL(/localhost:5173|127\.0\.0\.1:5173/, {
    timeout: 30_000,
  })
  await expect(page).not.toHaveURL(/8180|openid-connect/, { timeout: 30_000 })
  await expect(page.locator('header.topbar')).toBeVisible({ timeout: 20_000 })
}

/** Full UI path: Mice login → SSO → IdP credentials → Mice app. */
export async function signInWithSsoViaKeycloak(page: Page) {
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  await page.getByRole('link', { name: 'Sign in with SSO' }).click()
  await completeKeycloakLogin(page)
}

/** Account menu → Sign out (follows IdP end-session back to /login). */
export async function signOutViaUi(page: Page) {
  const menu = page.locator('details.profile-menu')
  // Ensure open (clicking summary toggles — close first if already open)
  if (await menu.evaluate((el) => (el as HTMLDetailsElement).open)) {
    await menu.locator('summary').click()
  }
  await openAccountMenu(page)
  await expect(menu.getByRole('button', { name: 'Sign out' })).toBeVisible()
  await menu.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.locator('header.topbar')).toHaveCount(0)
}
