import { test as base, expect } from '@playwright/test'
import { openAccountMenu } from '../fixtures'
import {
  expectKeycloakLoginForm,
  signInWithSsoViaKeycloak,
  signOutViaUi,
} from '../helpers/keycloak'

const BASE_URL = process.env.BOXEN_BASE_URL ?? 'http://localhost:5173'

/** Auth tests control their own session (do not use the auto-login fixture). */
const test = base

async function uiDevLogin(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  await page.getByRole('button', { name: 'Dev login' }).click()
  await expect(page).toHaveURL(/\/$|\/projects|\/namespaces/)
  await expect(page.locator('header.topbar')).toBeVisible()
}

test.describe('auth BFF (PLAT-AUTH)', () => {
  test('TC-AUTH-02: unauthenticated /api returns 401', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/version`)
    expect(res.status()).toBe(401)
    const body = await res.json()
    expect(body.status).toBe('error')
  })

  test('TC-AUTH-03: dev-login then /auth/me and /api/version succeed', async ({
    page,
  }) => {
    const login = await page.request.post(`${BASE_URL}/auth/dev-login`, {
      data: {
        name: 'Auth Spec',
        email: 'auth-spec@boxen.local',
        sub: 'auth-spec',
        iss: 'boxen-dev',
      },
    })
    expect(login.ok()).toBeTruthy()

    const me = await page.request.get(`${BASE_URL}/auth/me`)
    expect(me.ok()).toBeTruthy()
    const meBody = await me.json()
    expect(meBody.authenticated).toBe(true)
    expect(meBody.user.email).toBe('auth-spec@boxen.local')

    const version = await page.request.get(`${BASE_URL}/api/version`)
    expect(version.ok()).toBeTruthy()
  })

  test('TC-AUTH-04: POST /auth/logout clears session cookie', async ({
    page,
  }) => {
    await page.request.post(`${BASE_URL}/auth/dev-login`, { data: {} })
    const before = await page.context().cookies()
    expect(before.some((c) => c.name === 'boxen_session')).toBeTruthy()

    const logout = await page.request.post(`${BASE_URL}/auth/logout`)
    expect(logout.ok()).toBeTruthy()

    const me = await page.request.get(`${BASE_URL}/auth/me`)
    expect(me.status()).toBe(401)
    const api = await page.request.get(`${BASE_URL}/api/version`)
    expect(api.status()).toBe(401)

    const after = await page.context().cookies()
    const session = after.find((c) => c.name === 'boxen_session')
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
    expect(location).toMatch(/realms\/boxen|openid-connect\/auth|keycloak|8180/)
    expect(location).toMatch(/prompt=login/)
  })

  test('TC-AUTH-06: login page offers SSO without app chrome', async ({
    page,
  }) => {
    await page.goto('/login')
    await expect(page.getByText('BOXEN', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await expect(
      page.getByRole('link', { name: 'Sign in with SSO' }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Dev login' })).toBeVisible()
    await expect(page.locator('header.topbar')).toHaveCount(0)
    await expect(page.locator('.login-shell')).toBeVisible()
    await expect(page.locator('main.login-page')).toBeVisible()
  })

  test('TC-AUTH-08: UI Dev login reaches app and shows identity', async ({
    page,
  }) => {
    await page.request.post(`${BASE_URL}/auth/dev-login`, {
      data: {
        name: 'UI Login User',
        email: 'ui-login@boxen.local',
        sub: 'ui-login',
        iss: 'boxen-dev',
      },
    })
    await page.goto('/')
    await expect(page.locator('header.topbar')).toBeVisible()
    await openAccountMenu(page)
    await expect(page.getByText('Signed as')).toBeVisible()
    await expect(page.getByText('UI Login User')).toBeVisible()
    await expect(page.getByText('ui-login@boxen.local')).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Sign out' }),
    ).toBeVisible()
  })

  test('TC-AUTH-09: UI Sign out returns to login and blocks app', async ({
    page,
  }) => {
    await uiDevLogin(page)

    await openAccountMenu(page)
    await page.getByRole('button', { name: 'Sign out' }).click()

    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await expect(page.locator('header.topbar')).toHaveCount(0)

    const me = await page.request.get(`${BASE_URL}/auth/me`)
    expect(me.status()).toBe(401)

    // Must not bounce back into the app if the cookie was not cleared
    await page.goto('/projects')
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await expect(page.locator('header.topbar')).toHaveCount(0)

    const api = await page.request.get(`${BASE_URL}/api/version`)
    expect(api.status()).toBe(401)
  })

  test('TC-AUTH-10: login?next= returns to deep link after Dev login', async ({
    page,
  }) => {
    await page.goto('/login?next=%2Fnamespaces')
    await page.getByRole('button', { name: 'Dev login' }).click()
    await expect(page).toHaveURL(/\/namespaces/)
    await expect(page.locator('header.topbar')).toBeVisible()
  })

  test('TC-AUTH-11: signed-in user visiting /login is sent into the app', async ({
    page,
  }) => {
    await page.request.post(`${BASE_URL}/auth/dev-login`, { data: {} })
    await page.goto('/login')
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.locator('header.topbar')).toBeVisible()
  })

  test('TC-AUTH-12: SSO → IdP credentials → sign out → SSO shows IdP form again', async ({
    page,
  }) => {
    // 1–2) Boxen login → SSO → Keycloak username/password → Boxen app
    await signInWithSsoViaKeycloak(page)
    await openAccountMenu(page)
    const menu = page.locator('.profile-menu-panel')
    await expect(menu.getByText('Boxen User')).toBeVisible()
    await expect(menu.getByText('boxen@example.com')).toBeVisible()
    // Close menu before signOutViaUi re-opens it (summary toggles)
    await page.locator('details.profile-menu > summary').click()

    // 3) Sign out clears Boxen session and IdP SSO, lands on /login
    await signOutViaUi(page)

    // 4) SSO again must show IdP credentials (not silent re-login)
    await page.getByRole('link', { name: 'Sign in with SSO' }).click()
    await expectKeycloakLoginForm(page)
    await expect(page).toHaveURL(/8180|\/realms\/boxen\//)
    await expect(page.locator('header.topbar')).toHaveCount(0)
    // Must be on IdP, not still on Boxen login card
    await expect(
      page.getByRole('link', { name: 'Sign in with SSO' }),
    ).toHaveCount(0)
  })
})
