import { test, expect, openSettings } from '../fixtures'
import { mintSession } from '../helpers/session'

async function openAdminSettings(page: Parameters<typeof openSettings>[0]) {
  await mintSession(page, { sub: `e2e-admin-${Date.now()}`, role: 'admin' })
  await page.goto('/')
  await openSettings(page)
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
}

test.describe('Settings · User Revocation (Admin)', () => {
  test('admin can open Revocations and see revoke/suspend forms', async ({ page }) => {
    await openAdminSettings(page)
    await page.getByRole('link', { name: 'Revocations', exact: true }).click()

    await expect(page.getByRole('heading', { name: 'User Revocation' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Revoke User Access' })).toBeVisible()
    await expect(page.getByRole('heading', { name: /Emergency Suspension/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Pending Confirmations' })).toBeVisible()
    await expect(
      page.locator('#user-revocation').getByRole('button', { name: /Revoke All Sessions/i }),
    ).toBeVisible()
    await expect(
      page.locator('#user-revocation').getByRole('button', { name: /Initiate Suspension/i }),
    ).toBeVisible()
    await expect(
      page.locator('#user-revocation').getByText(/No pending suspensions|Loading pending|awaiting second-admin/i).first(),
    ).toBeVisible({ timeout: 10_000 })
  })
})

test.describe('Settings · Disabled signers (Admin)', () => {
  test('admin can open Disabled signers and see load feedback', async ({ page }) => {
    await openAdminSettings(page)
    await page.getByRole('link', { name: 'Disabled signers', exact: true }).click()

    await expect(page.getByRole('heading', { name: 'Disabled signers' })).toBeVisible()
    await expect(
      page.locator('#disabled-signers').getByText(
        /No disabled Principal holds signing rights|Loading disabled signers|Critical/i,
      ).first(),
    ).toBeVisible({ timeout: 10_000 })
  })
})

test.describe('Settings · Access review (Admin)', () => {
  test('admin can open Access review and generate a report', async ({ page }) => {
    await openAdminSettings(page)
    await page.getByRole('link', { name: 'Access review', exact: true }).click()

    await expect(page.getByRole('heading', { name: 'Quarterly Access Review' })).toBeVisible()
    await expect(page.locator('#access-review').getByText(/No report open yet/i)).toBeVisible()

    const generate = page.locator('#access-review').getByRole('button', { name: /Generate Report/i })
    await expect(generate).toBeVisible()
    await generate.click()

    await expect(
      page.locator('#access-review').locator('.flash-success, .flash-error').first(),
    ).toBeVisible({ timeout: 15_000 })

    const reportHeading = page.locator('#access-review').getByRole('heading', { name: /Report:/i })
    if (await reportHeading.isVisible()) {
      await expect(page.locator('#access-review').getByText(/Principals/i).first()).toBeVisible()
    }
  })
})

test.describe('Settings · Seal keys (Admin)', () => {
  test('admin can open Seal keys and see current key + rotation actions', async ({ page }) => {
    await openAdminSettings(page)
    await page.getByRole('link', { name: 'Seal keys', exact: true }).click()

    await expect(page.getByRole('heading', { name: 'Session cookie keys' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Current Primary Key' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Key Rotation' })).toBeVisible()
    await expect(
      page.locator('#seal-key-rotation').getByRole('button', { name: /Perform Normal Rotation/i }),
    ).toBeVisible()
    await expect(
      page.locator('#seal-key-rotation').getByRole('button', { name: /Emergency Rotation/i }),
    ).toBeVisible()
    await expect(
      page.locator('#seal-key-rotation').getByText(/Key ID|Loading current key|Failed to load current key/i).first(),
    ).toBeVisible({ timeout: 10_000 })
  })
})

test.describe('Settings · IdP drift (Admin)', () => {
  test('admin can open IdP drift and see baseline / reports feedback', async ({ page }) => {
    await openAdminSettings(page)
    await page.getByRole('link', { name: 'IdP drift', exact: true }).click()

    await expect(page.getByRole('heading', { name: 'IdP drift' })).toBeVisible()
    await expect(
      page.locator('#idp-drift').getByRole('button', { name: /Check now/i }),
    ).toBeVisible({ timeout: 10_000 })
    await expect(
      page.locator('#idp-drift').getByRole('heading', { name: 'Replace baseline' }),
    ).toBeVisible()
    await expect(
      page.locator('#idp-drift').getByText(
        /No IdP baseline is stored|Current baseline|No drift reports yet|Loading IdP drift/i,
      ).first(),
    ).toBeVisible({ timeout: 10_000 })
  })
})
