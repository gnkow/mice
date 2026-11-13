import { expect } from '@playwright/test'
import { cleanTest as test } from '../fixtures'
import { uniqueId } from '../helpers/oxenApi'
import { mintSession, mintSessionCookie } from '../helpers/session'

test.describe('RBAC web UI (#16)', () => {
  test('TC-RBAC-E1: a user without a role sees only Request Access and ends on a pending page', async ({ page }) => {
    await mintSession(page, {
      role: 'none',
      sub: uniqueId('norole'),
      iss: 'mice-e2e',
      name: 'No Role',
      email: `norole-${uniqueId('e')}@mice.local`,
    })
    await page.goto('/namespaces')
    await expect(page).toHaveURL(/\/pending$/)
    await expect(page.getByRole('heading', { name: 'Request access' })).toBeVisible()
    await expect(page.getByRole('navigation')).toHaveCount(0)

    await page.getByRole('radio', { name: /Formal role/ }).check()
    await page.getByRole('button', { name: 'Continue' }).click()
    await page
      .locator('label.pending-access-role-card')
      .filter({ has: page.locator('strong', { hasText: /^User$/ }) })
      .click()
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByLabel(/Justification/).fill('Need access to review data')
    await page.getByRole('button', { name: 'Request access' }).click()

    await expect(page.getByRole('heading', { name: 'Request pending' })).toBeVisible()
    await expect(page.getByText('User', { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('navigation')).toHaveCount(0)

    // Reload shows the existing pending request; a new submit overrides it.
    await page.goto('/pending')
    await expect(page.getByRole('heading', { name: 'Request pending' })).toBeVisible()
    await page.getByRole('button', { name: 'Update request' }).click()
    await expect(page.getByRole('heading', { name: 'Update request' })).toBeVisible()
    await page.getByRole('radio', { name: /Formal role/ }).check()
    await page.getByRole('button', { name: 'Continue' }).click()
    await page
      .locator('label.pending-access-role-card')
      .filter({ has: page.locator('strong', { hasText: /^Manager$/ }) })
      .click()
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByLabel(/Justification/).fill('Need manager access instead')
    await page.getByRole('button', { name: 'Update request' }).click()
    await expect(page.getByRole('heading', { name: 'Request pending' })).toBeVisible()
    await expect(page.getByText('Manager', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Need manager access instead')).toBeVisible()

    await page.goto('/profile')
    await expect(page).toHaveURL(/\/pending$/)
  })

  test('TC-RBAC-E2: Profile shows the role badge, the permission checklist and a pending upgrade request', async ({ page }) => {
    await mintSession(page, {
      role: 'user',
      sub: uniqueId('profile'),
      iss: 'mice-e2e',
      name: 'Profile User',
      email: `profile-${uniqueId('e')}@mice.local`,
    })
    await page.goto('/profile')
    await expect(page.getByText('User', { exact: true }).first()).toBeVisible()
    const permissions = page.locator('#profile-permissions')
    const authz = await (await page.request.get('/auth/me/authz')).json()
    await expect(permissions).toContainText(`Instance permissions (${authz.effectivePermissions.length} granted)`)
    await expect(permissions.locator('code', { hasText: authz.effectivePermissions[0] }).first()).toBeVisible()

    await permissions.getByRole('button', { name: 'Request additional permissions' }).click()
    await permissions.getByRole('radio', { name: /^Manager/ }).check()
    await permissions.getByLabel('Justification (required)').fill('Need to manage namespaces')
    await permissions.getByRole('button', { name: 'Submit request' }).click()
    await expect(permissions).toContainText('Request pending')
    await expect(permissions.getByRole('button', { name: 'Request additional permissions' })).toHaveCount(0)
  })

  test('TC-RBAC-E3: Settings Users grants a role directly and shows the authority error for a permission the grantor lacks', async ({ page }) => {
    const targetName = `Grant Target ${uniqueId('t')}`
    await mintSessionCookie({
      role: 'none',
      sub: uniqueId('grant-target'),
      iss: 'mice-e2e',
      name: targetName,
      email: `target-${uniqueId('e')}@mice.local`,
    })
    await mintSession(page, {
      role: 'manager',
      sub: uniqueId('grantor'),
      iss: 'mice-e2e',
      name: 'Grantor Manager',
      email: `grantor-${uniqueId('e')}@mice.local`,
    })
    await page.goto('/settings')
    const users = page.locator('#users-grant')
    const row = users.locator('li', { hasText: targetName })

    await row.getByRole('button', { name: 'Grant Access' }).click()
    await users.locator('select').selectOption({ label: 'No role change' })
    await users.locator('label', { hasText: 'repo:bypass_acl' }).getByRole('checkbox').check()
    await users.getByLabel('Reason (required)').fill('Trying to grant above my authority')

    let denyAuthority = true
    await page.route('**/auth/grants/**', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue()
        return
      }
      if (denyAuthority) {
        await route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Insufficient authority to grant this permission' }),
        })
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      })
    })

    await users.getByRole('button', { name: 'Grant', exact: true }).click()
    await expect(users.getByRole('alert')).toContainText('Authority:')

    denyAuthority = false
    await users.locator('select').selectOption({ label: 'User' })
    await users.locator('label', { hasText: 'repo:bypass_acl' }).getByRole('checkbox').uncheck()
    await users.getByLabel('Reason (required)').fill('Onboarding')
    await users.getByRole('button', { name: 'Grant', exact: true }).click()
    await expect(users.getByRole('status')).toContainText(/Granted access/i)
  })

  test('TC-RBAC-E4: request wizard footnotes Admin/Auditor as grant-only', async ({ page }) => {
    await mintSession(page, {
      role: 'none',
      sub: uniqueId('footnote'),
      iss: 'mice-e2e',
    })
    await page.goto('/pending')
    await expect(page.getByRole('heading', { name: 'Request access' })).toBeVisible()
    await expect(
      page.getByText(/Admin and Auditor are grant-only/i),
    ).toBeVisible()
    await page.getByRole('radio', { name: /Formal role/ }).check()
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByTestId('requestable-roles-footnote')).toContainText(
      /not self-service/i,
    )
  })

  test('TC-RBAC-E5: Admin profile states separation of duties; review form notes authority', async ({
    page,
  }) => {
    await mintSession(page, {
      role: 'admin',
      sub: uniqueId('sod-profile'),
      iss: 'mice-e2e',
    })
    await page.goto('/profile')
    await expect(page.getByTestId('admin-sod-profile-note')).toContainText(
      /platform-only|separation of duties/i,
    )

    await page.route('**/auth/access-requests', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          requests: [
            {
              id: 'req-rbac-e5',
              status: 'pending',
              name: 'Requester',
              email: 'req@mice.local',
              sub: 'req-sub',
              iss: 'mice-e2e',
              requestedRole: 'user',
              message: 'Need user',
              createdAt: new Date().toISOString(),
            },
          ],
        }),
      })
    })
    await page.goto('/settings')
    const section = page.locator('#access-requests')
    await section.getByRole('button', { name: 'Review' }).click()
    await expect(section.getByTestId('access-request-authority-hint')).toContainText(
      /authority|Expiry is required/i,
    )
  })
})
