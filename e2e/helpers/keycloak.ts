import { createHmac } from 'node:crypto'
import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { openAccountMenu } from '../fixtures'

const KC_USER = process.env.KEYCLOAK_E2E_USER ?? 'mice'
const KC_PASSWORD = process.env.KEYCLOAK_E2E_PASSWORD ?? 'mice'

/** Pre-seeded TOTP for `mice_mfa` in `auth/keycloak/realm-mice.json`. */
export const KEYCLOAK_MFA_USER = process.env.KEYCLOAK_E2E_MFA_USER ?? 'mice_mfa'
export const KEYCLOAK_MFA_PASSWORD = process.env.KEYCLOAK_E2E_MFA_PASSWORD ?? 'mfa123'
/**
 * Must match `secretData.value` on the realm-import OTP credential. Keycloak treats that
 * value as raw UTF-8 key material (not base32-decoded) for this import shape.
 */
export const KEYCLOAK_MFA_TOTP_SECRET =
  process.env.KEYCLOAK_E2E_MFA_TOTP_SECRET ?? 'JBSWY3DPEHPK3PXP'

/** RFC 6238 TOTP (SHA-1, 6 digits, 30s) for the Keycloak e2e MFA user. */
export function totpCode(secret = KEYCLOAK_MFA_TOTP_SECRET, atMs = Date.now()): string {
  const key = Buffer.from(secret, 'utf8')
  const counter = Math.floor(atMs / 1000 / 30)
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(counter))
  const digest = createHmac('sha1', key).update(msg).digest()
  const offset = digest[digest.length - 1]! & 0xf
  const code =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff)
  return String(code % 1_000_000).padStart(6, '0')
}

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

export function keycloakOtpInput(page: Page) {
  return page.locator('#otp, input[name="otp"], input#otp').first()
}

/** Submit the OTP form when Conditional OTP challenged the user. */
export async function completeKeycloakOtp(
  page: Page,
  secretBase32 = KEYCLOAK_MFA_TOTP_SECRET,
) {
  await expect(keycloakOtpInput(page)).toBeVisible({ timeout: 20_000 })
  await keycloakOtpInput(page).fill(totpCode(secretBase32))
  await keycloakSubmit(page).click()
}

/** Complete Keycloak username/password and land back in Mice. */
export async function completeKeycloakLogin(
  page: Page,
  user = KC_USER,
  password = KC_PASSWORD,
  opts: { totpSecret?: string } = {},
) {
  await expectKeycloakLoginForm(page)
  await keycloakUsername(page).fill(user)
  await keycloakPassword(page).fill(password)
  await keycloakSubmit(page).click()
  if (opts.totpSecret) {
    await completeKeycloakOtp(page, opts.totpSecret)
  } else {
    const otp = keycloakOtpInput(page)
    try {
      await otp.waitFor({ state: 'visible', timeout: 5_000 })
      await completeKeycloakOtp(page)
    } catch {
      /* password-only user */
    }
  }
  await expect(page).toHaveURL(/localhost:5173|127\.0\.0\.1:5173/, {
    timeout: 30_000,
  })
  await expect(page).not.toHaveURL(/8180|openid-connect/, { timeout: 30_000 })
  await expect(page.locator('header.topbar')).toBeVisible({ timeout: 20_000 })
}

/** Mice login → SSO → Keycloak password + TOTP (mice_mfa) → Mice app. */
export async function signInWithKeycloakMfa(page: Page) {
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  await page.getByRole('link', { name: 'Sign in with SSO' }).click()
  await completeKeycloakLogin(page, KEYCLOAK_MFA_USER, KEYCLOAK_MFA_PASSWORD, {
    totpSecret: KEYCLOAK_MFA_TOTP_SECRET,
  })
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
