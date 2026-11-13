import { expect, test } from '@playwright/test'

/** Surface-only: no BFF session mint / cleanup (does not use cleanTest). */

/**
 * LoginPage refuse / IdP status surfaces (tickets 04, 32, 38).
 * Codes match auth callback redirects: /login?status=<code>
 */
const SURFACES = [
  {
    code: 'disabled',
    title: 'Sign-in refused',
    message: 'Your account has been disabled by the administrator.',
  },
  {
    code: 'missing',
    title: 'Sign-in refused',
    message: 'Your account was not found in the directory.',
  },
  {
    code: 'empty_name',
    title: 'Sign-in refused',
    message: 'Your account has no name in the identity provider.',
  },
  {
    code: 'unreachable',
    title: 'Identity provider unavailable',
    message: 'IdP is unreachable. Login cannot be verified at this time.',
  },
] as const

test.describe('login status surfaces', () => {
  for (const surface of SURFACES) {
    test(`TC-LOGIN-STATUS: ${surface.code} shows titled alert on LoginPage`, async ({
      page,
    }) => {
      await page.goto(`/login?status=${surface.code}`)
      await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
      const alert = page.getByTestId('login-status')
      await expect(alert).toBeVisible()
      await expect(alert).toHaveAttribute('role', 'alert')
      await expect(alert).toHaveAttribute('data-status', surface.code)
      await expect(
        alert.getByRole('heading', { name: surface.title }),
      ).toBeVisible()
      await expect(alert.getByText(surface.message, { exact: true })).toBeVisible()
      await expect(page.getByRole('link', { name: 'Sign in with SSO' })).toBeVisible()
      await expect(page.locator('header.topbar')).toHaveCount(0)
    })
  }

  test('TC-LOGIN-STATUS: clean /login has no orphan status alert', async ({
    page,
  }) => {
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await expect(page.getByTestId('login-status')).toHaveCount(0)
    await expect(page.getByRole('alert')).toHaveCount(0)
  })

  test('TC-LOGIN-STATUS: unknown status code shows no alert', async ({
    page,
  }) => {
    await page.goto('/login?status=not-a-real-code')
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await expect(page.getByTestId('login-status')).toHaveCount(0)
  })

  // Ticket 02 tracer deepen (also covered in auth.spec when the stack is up).
  test('TC-LOGIN-STATUS: SSO href uses prompt=login and preserves next', async ({
    page,
  }) => {
    await page.goto('/login')
    await expect(page.locator('main.login-page')).toHaveAttribute(
      'aria-labelledby',
      'login-heading',
    )
    await expect(page.getByRole('link', { name: 'Sign in with SSO' })).toHaveAttribute(
      'href',
      '/auth/login?prompt=login',
    )
    await page.goto('/login?next=%2Fnamespaces')
    await expect(page.getByRole('link', { name: 'Sign in with SSO' })).toHaveAttribute(
      'href',
      '/auth/login?prompt=login&next=%2Fnamespaces',
    )
  })
})
