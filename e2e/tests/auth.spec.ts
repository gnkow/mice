import { test as base, expect } from '@playwright/test'
import { openAccountMenu } from '../fixtures'
import {
  expectKeycloakLoginForm,
  signInWithSsoViaKeycloak,
  signOutViaUi,
} from '../helpers/keycloak'
import { mintSession } from '../helpers/session'

const BASE_URL = process.env.MICE_BASE_URL ?? 'http://localhost:5173'

/** Auth tests control their own session (do not use the auto-login fixture). */
const test = base

test.describe('auth BFF (PLAT-AUTH)', () => {
  test('TC-AUTH-02: unauthenticated /api returns 401', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/version`)
    expect(res.status()).toBe(401)
    const body = await res.json()
    expect(body.status).toBe('error')
  })

  test('TC-AUTH-03: session then /auth/me and /api/version succeed', async ({
    page,
  }) => {
    await mintSession(page, {
      name: 'Auth Spec',
      email: 'auth-spec@mice.local',
      sub: 'auth-spec',
      iss: 'mice-e2e',
    })

    const me = await page.request.get(`${BASE_URL}/auth/me`)
    expect(me.ok()).toBeTruthy()
    const meBody = await me.json()
    expect(meBody.authenticated).toBe(true)
    expect(meBody.user.email).toBe('auth-spec@mice.local')

    const version = await page.request.get(`${BASE_URL}/api/version`)
    expect(version.ok()).toBeTruthy()
  })

  test('TC-AUTH-04: POST /auth/logout clears session cookie', async ({
    page,
  }) => {
    await mintSession(page)
    const before = await page.context().cookies()
    expect(before.some((c) => c.name === 'mice_session')).toBeTruthy()

    const logout = await page.request.post(`${BASE_URL}/auth/logout`)
    expect(logout.ok()).toBeTruthy()

    const me = await page.request.get(`${BASE_URL}/auth/me`)
    expect(me.status()).toBe(401)
    const api = await page.request.get(`${BASE_URL}/api/version`)
    expect(api.status()).toBe(401)

    const after = await page.context().cookies()
    const session = after.find((c) => c.name === 'mice_session')
    expect(!session || !session.value || session.expires === -1).toBeTruthy()
  })

  test('TC-AUTH-05: /auth/login redirects to Keycloak authorize with prompt=login', async ({
    request,
  }) => {
    const res = await request.get(`${BASE_URL}/auth/login?prompt=login`, {
      maxRedirects: 0,
    })
    const status = res.status()
    expect([302, 303, 307, 308].includes(status) || status === 200).toBeTruthy()
    const location = res.headers()['location'] ?? res.url()
    expect(location).toMatch(/realms\/mice|openid-connect\/auth|keycloak|8180/)
    expect(location).toMatch(/prompt=login/)
  })

  test('TC-AUTH-06: login page offers SSO without app chrome', async ({
    page,
  }) => {
    await page.goto('/login')
    await expect(page.getByText('MICE', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await expect(
      page.getByRole('link', { name: 'Sign in with SSO' }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Dev login' })).toHaveCount(0)
    await expect(page.locator('header.topbar')).toHaveCount(0)
    await expect(page.locator('.login-shell')).toBeVisible()
    await expect(page.locator('main.login-page')).toBeVisible()
  })

  test('TC-AUTH-08: UI session shows identity in account menu', async ({
    page,
  }) => {
    await mintSession(page, {
      name: 'UI Login User',
      email: 'ui-login@mice.local',
      sub: 'ui-login',
      iss: 'mice-e2e',
    })
    await page.goto('/')
    await expect(page.locator('header.topbar')).toBeVisible()
    await openAccountMenu(page)
    await expect(page.locator('.profile-menu-panel').getByRole('link')).toHaveText(['Profile', 'Settings'])
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
    await page.locator('.profile-menu-panel').getByRole('link', { name: 'Profile', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible()
    await expect(page.getByText('Signed as')).toBeVisible()
    await expect(page.getByText('UI Login User')).toBeVisible()
    await expect(page.getByText('ui-login@mice.local')).toBeVisible()
  })

  test('TC-AUTH-09: UI Sign out returns to login and blocks app', async ({
    page,
  }) => {
    await mintSession(page)
    await page.goto('/')
    await expect(page.locator('header.topbar')).toBeVisible()

    await openAccountMenu(page)
    await page.getByRole('button', { name: 'Sign out' }).click()

    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await expect(page.locator('header.topbar')).toHaveCount(0)

    const me = await page.request.get(`${BASE_URL}/auth/me`)
    expect(me.status()).toBe(401)

    // Must not bounce back into the app if the cookie was not cleared
    await page.goto('/repositories')
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await expect(page.locator('header.topbar')).toHaveCount(0)

    const api = await page.request.get(`${BASE_URL}/api/version`)
    expect(api.status()).toBe(401)
  })

  test('TC-AUTH-10: login?next= returns to deep link when already signed in', async ({
    page,
  }) => {
    await mintSession(page)
    await page.goto('/login?next=%2Fnamespaces')
    await expect(page).toHaveURL(/\/namespaces/)
    await expect(page.locator('header.topbar')).toBeVisible()
  })

  test('TC-AUTH-11: signed-in user visiting /login is sent into the app', async ({
    page,
  }) => {
    await mintSession(page)
    await page.goto('/login')
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.locator('header.topbar')).toBeVisible()
  })

  test('TC-AUTH-12: SSO → IdP credentials → sign out → SSO shows IdP form again', async ({
    page,
  }) => {
    // 1–2) Mice login → SSO → Keycloak username/password → Mice app
    await signInWithSsoViaKeycloak(page)
    await openAccountMenu(page)
    const menu = page.locator('.profile-menu-panel')
    await expect(menu.getByText('Mice User')).toBeVisible()
    await expect(menu.getByText('mice@example.com')).toBeVisible()
    // Close menu before signOutViaUi re-opens it (summary toggles)
    await page.locator('details.profile-menu > summary').click()

    // 3) Sign out clears Mice session and IdP SSO, lands on /login
    await signOutViaUi(page)

    // 4) SSO again must show IdP credentials (not silent re-login)
    await page.getByRole('link', { name: 'Sign in with SSO' }).click()
    await expectKeycloakLoginForm(page)
    await expect(page).toHaveURL(/8180|\/realms\/mice\//)
    await expect(page.locator('header.topbar')).toHaveCount(0)
    // Must be on IdP, not still on Mice login card
    await expect(
      page.getByRole('link', { name: 'Sign in with SSO' }),
    ).toHaveCount(0)
  })
})
