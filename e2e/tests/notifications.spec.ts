import { expect } from '@playwright/test'
import { cleanTest as test } from '../fixtures'
import { INSTANCE_PERMISSIONS } from '../../auth/src/authzContract'

// /auth/me/authz must carry every instance permission or the web rejects it.
const noPermissions = Object.fromEntries(INSTANCE_PERMISSIONS.map((p) => [p, false]))
import { mintSession } from '../helpers/session'

test('notification preferences persist', async ({ page }) => {
  await mintSession(page, { sub: `notification-${Date.now()}` })
  await page.goto('/notifications')
  await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible()
  await page.goto('/profile/notifications')
  await page.getByLabel('Enable notifications', { exact: true }).uncheck()
  await page.getByRole('button', { name: 'Save preferences' }).click()
  await expect(page.getByText('Notification preferences saved.')).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Enable notifications', { exact: true })).not.toBeChecked()
})

test('notification inbox and profile settings stay available without resource grants', async ({ page }) => {
  let pending = true
  let tokenCreated = false
  const categories = Object.fromEntries(
    ['access', 'jobs', 'sessions', 'repositories', 'files', 'metadata', 'security', 'announcements']
      .map((category) => [category, { enabled: true, toast: true, email: false, push: false }]),
  )
  let preferences = {
    enabled: true,
    categories,
    emailSchedule: 'immediate',
    timezone: 'UTC',
    quietHours: { enabled: false, start: '22:00', end: '08:00' },
    resourceOverrides: [],
  }
  const item = {
    id: 'personal-access-notice',
    category: 'access',
    title: 'Access changed',
    summary: 'Your access permissions have changed.',
    createdAt: new Date().toISOString(),
    read: false,
    count: 1,
  }
  await page.route('**/api/**', (route) =>
    route.fulfill({ json: { oxen_version: 'test' } }))
  await page.route('**/auth/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path === '/auth/me') {
      return route.fulfill({ json: {
        authenticated: true,
        user: { sub: 'notification-user', iss: 'test', name: 'Notification User', email: 'user@example.test' },
      } })
    }
    if (path === '/auth/me/authz') {
      return route.fulfill({ json: {
        enforce: true, pending, instanceAdmin: !pending,
        permissions: { ...noPermissions, manage_own_tokens: !pending }, hasAnyGrant: !pending,
      } })
    }
    if (path === '/auth/instance') {
      return route.fulfill({ json: { enforce: true, admins: [], permissions: [] } })
    }
    if (path === '/auth/tokens') {
      if (request.method() === 'POST') {
        tokenCreated = true
        return route.fulfill({ json: { token: 'mice_pat_browser-test-only' } })
      }
      return route.fulfill({ json: { tokens: tokenCreated ? [{
        id: 'profile-token', label: 'Profile automation', prefix: 'mice_pat_test',
        createdAt: new Date().toISOString(),
      }] : [] } })
    }
    if (path === '/auth/tokens/profile-token' && request.method() === 'DELETE') {
      tokenCreated = false
      return route.fulfill({ json: { ok: true } })
    }
    if (path === '/auth/access-requests') {
      return route.fulfill({ json: { requests: [], reviewNamespaces: [] } })
    }
    if (path === '/auth/namespaces') {
      return route.fulfill({ json: { namespaces: [] } })
    }
    if (path === '/auth/notifications/preferences') {
      if (request.method() === 'PATCH') preferences = request.postDataJSON()
      return route.fulfill({ json: {
        preferences, availability: { email: false, push: false },
      } })
    }
    if (path === '/auth/notifications/toast') {
      return route.fulfill({ json: { items: [] } })
    }
    if (path === '/auth/notifications/unread-count') {
      return route.fulfill({ json: { unreadCount: item.read ? 0 : 1 } })
    }
    if (path === '/auth/notifications/read-all') {
      item.read = true
      return route.fulfill({ json: { ok: true } })
    }
    if (path === `/auth/notifications/${item.id}` && request.method() === 'PATCH') {
      item.read = request.postDataJSON().read
      return route.fulfill({ json: { ok: true } })
    }
    if (path === '/auth/notifications') {
      return route.fulfill({ json: { items: [item], unreadCount: item.read ? 0 : 1 } })
    }
    return route.fulfill({ status: 404, json: { error: 'Unexpected notification test request' } })
  })

  await page.goto('/notifications')
  await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible()
  await expect(page.getByText(item.summary, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Mark all read' }).click()
  await expect.poll(() => item.read).toBe(true)
  await expect(page).toHaveURL(/\/notifications$/)

  await page.goto('/profile/notifications')
  await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible()
  await expect(page.getByText(/not configured/i).first()).toBeVisible()
  await expect(page).toHaveURL(/\/profile$/)
  await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible()
  await expect(page.locator('header').getByLabel('Theme', { exact: true })).toHaveCount(0)
  await page.getByRole('radio', { name: 'Dark', exact: true }).check()
  await expect(page.locator('html')).toHaveAttribute('data-color-mode', 'dark')
  await page.getByRole('radio', { name: 'Colorblind', exact: true }).check()
  await expect(page.locator('html')).toHaveAttribute('data-diff-palette', 'colorblind')
  await page.reload()
  await expect(page.getByRole('radio', { name: 'Dark', exact: true })).toBeChecked()
  await expect(page.getByRole('radio', { name: 'Colorblind', exact: true })).toBeChecked()
  await page.getByLabel('Account menu').click()
  await expect(page.locator('.profile-menu-panel').getByRole('link')).toHaveText(['Profile', 'Settings'])
  await expect(page.locator('.profile-menu-panel').getByRole('button')).toHaveText(['Sign out'])
  pending = false
  await page.locator('.profile-menu-panel').getByRole('link', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('navigation', { name: 'Settings sections' })).toHaveCount(0)
  await expect(page.locator('main h2').first()).toHaveText('Connection')
  await expect(page.getByRole('heading', { name: 'Access', exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Access requests', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Authorization policy', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Instance administrators', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Delegated permissions', exact: true })).toBeVisible()
  await page.goto('/profile')
  await expect(page.getByRole('heading', { name: 'Access', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Device Sessions', exact: false })).toBeVisible()
})
