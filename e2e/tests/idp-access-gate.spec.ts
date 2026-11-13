import { expect, test } from '@playwright/test'

/**
 * Ticket 19 — Live IdP check failures surface in RequireAuth (mocked /auth/me).
 * Surface-only: no BFF session mint (does not use cleanTest).
 */

test.describe('live IdP access gate (#19)', () => {
  test('TC-IDP-GATE-503: unavailable IdP shows route-level alert instead of blank shell', async ({
    page,
  }) => {
    await page.route('**/auth/me', async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        json: {
          authenticated: false,
          error: 'Service Unavailable - IdP check failed',
        },
      })
    })

    await page.goto('/')
    const alert = page.getByTestId('idp-access-gate')
    await expect(alert).toBeVisible()
    await expect(alert).toHaveAttribute('role', 'alert')
    await expect(alert).toHaveAttribute('data-gate', 'unavailable')
    await expect(alert).toHaveAttribute('data-status', '503')
    await expect(
      alert.getByRole('heading', { name: 'Identity provider unavailable' }),
    ).toBeVisible()
    await expect(alert).toContainText(/IdP check failed|identity provider/i)
    await expect(page.getByRole('heading', { name: 'Sign-in check' })).toBeVisible()
    await expect(page.locator('header.topbar')).toHaveCount(0)
  })

  test('TC-IDP-GATE-403: access refused shows route-level alert', async ({ page }) => {
    await page.route('**/auth/me', async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        json: { authenticated: false, error: 'Suspended' },
      })
    })

    await page.goto('/')
    const alert = page.getByTestId('idp-access-gate')
    await expect(alert).toBeVisible()
    await expect(alert).toHaveAttribute('role', 'alert')
    await expect(alert).toHaveAttribute('data-gate', 'refused')
    await expect(alert).toHaveAttribute('data-status', '403')
    await expect(alert.getByRole('heading', { name: 'Access refused' })).toBeVisible()
    await expect(alert.getByText('Suspended', { exact: true })).toBeVisible()
  })
})
