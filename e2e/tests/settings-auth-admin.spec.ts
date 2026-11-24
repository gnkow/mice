import { test, expect, openSettings } from '../fixtures'
import { mockDirectorySearch, pickFromDirectory } from '../helpers/directory'
import { mintSession } from '../helpers/session'

async function openAdminSettings(
  page: Parameters<typeof openSettings>[0],
  opts: { mfa?: boolean } = {},
) {
  await mintSession(page, {
    sub: `e2e-admin-${Date.now()}`,
    role: 'admin',
    iss: 'mice-e2e',
    ...(opts.mfa ? { mfa: true } : {}),
  })
  await page.goto('/')
  await openSettings(page)
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
}

async function stubRevocationTargets(page: Parameters<typeof openSettings>[0]) {
  await mockDirectorySearch(page, [
    {
      kind: 'user',
      sub: 'revoke-target',
      iss: 'mice-e2e',
      name: 'Revoke Target',
      email: 'revoke-target@mice.local',
    },
    {
      kind: 'user',
      sub: 'suspend-target',
      iss: 'mice-e2e',
      name: 'Suspend Target',
      email: 'suspend-target@mice.local',
    },
  ])
}

test.describe('Settings · User Revocation (Admin)', () => {
  test('admin can open Revocations and see revoke/suspend forms', async ({ page }) => {
    await openAdminSettings(page)
    await page.getByRole('link', { name: 'User Revocation', exact: true }).click()

    const section = page.getByTestId('admin-revocation')
    await expect(section).toBeVisible()
    await expect(page.getByRole('heading', { name: 'User Revocation' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Revoke User Access' })).toBeVisible()
    await expect(page.getByRole('heading', { name: /Emergency Suspension/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Pending Confirmations' })).toBeVisible()

    await expect(section.getByTestId('admin-revoke-form')).toBeVisible()
    await expect(section.getByTestId('admin-suspend-form')).toBeVisible()
    await expect(section.getByTestId('admin-pending-suspensions')).toBeVisible()

    await expect(section.getByText(/electronic signature ceremony/i)).toBeVisible()
    await expect(section.getByText(/Access is cut only after confirmation/i)).toBeVisible()
    await expect(section.getByTestId('admin-revoke-form').getByLabel('Search directory')).toBeVisible()
    await expect(section.getByTestId('admin-suspend-form').getByLabel('Search directory')).toBeVisible()
    await expect(
      section.getByRole('button', { name: /Revoke All Sessions/i }),
    ).toBeVisible()
    await expect(
      section.getByRole('button', { name: /Initiate Suspension/i }),
    ).toBeVisible()
    await expect(
      section.getByText(/No pending suspensions|Loading pending|awaiting second-admin/i).first(),
    ).toBeVisible({ timeout: 10_000 })
  })

  test('revoke and suspend actions stay disabled until principal and reason are filled', async ({
    page,
  }) => {
    await openAdminSettings(page)
    await stubRevocationTargets(page)
    await page.getByRole('link', { name: 'User Revocation', exact: true }).click()

    const revoke = page.getByTestId('admin-revoke-form')
    const suspend = page.getByTestId('admin-suspend-form')

    await expect(revoke.getByRole('button', { name: /Revoke All Sessions/i })).toBeDisabled()
    await expect(suspend.getByRole('button', { name: /Initiate Suspension/i })).toBeDisabled()

    await pickFromDirectory(revoke, 'revoke-target', /Revoke Target|revoke-target/)
    await expect(revoke.getByRole('button', { name: /Revoke All Sessions/i })).toBeDisabled()
    await revoke.getByPlaceholder(/Security incident/i).fill('e2e revoke reason')
    await expect(revoke.getByRole('button', { name: /Revoke All Sessions/i })).toBeEnabled()

    await pickFromDirectory(suspend, 'suspend-target', /Suspend Target|suspend-target/)
    await expect(suspend.getByRole('button', { name: /Initiate Suspension/i })).toBeDisabled()
    await suspend.getByPlaceholder(/account compromise/i).fill('e2e suspend reason')
    await expect(suspend.getByRole('button', { name: /Initiate Suspension/i })).toBeEnabled()
  })

  test('TC-GXP-121-01: revoke opens the electronic signature ceremony; cancel stays on the form', async ({
    page,
  }) => {
    await openAdminSettings(page, { mfa: true })
    await stubRevocationTargets(page)
    await page.getByRole('link', { name: 'User Revocation', exact: true }).click()

    const revoke = page.getByTestId('admin-revoke-form')
    await pickFromDirectory(revoke, 'revoke-target', /Revoke Target|revoke-target/)
    await revoke.getByPlaceholder(/Security incident/i).fill('e2e revoke ceremony coverage')
    await revoke.getByRole('button', { name: /Revoke All Sessions/i }).click()

    const dialog = page.getByRole('dialog', {
      name: /Reason and signature required|Signature Required|Electronic signature/i,
    })
    await expect(dialog).toBeVisible({ timeout: 15_000 })
    await dialog.getByRole('button', { name: /Cancel/i }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByTestId('admin-revoke-form')).toBeVisible()
  })

  test('TC-GXP-121-02: initiate suspension opens the signature ceremony', async ({ page }) => {
    await openAdminSettings(page, { mfa: true })
    await stubRevocationTargets(page)
    await page.getByRole('link', { name: 'User Revocation', exact: true }).click()

    const suspend = page.getByTestId('admin-suspend-form')
    await pickFromDirectory(suspend, 'suspend-target', /Suspend Target|suspend-target/)
    await suspend
      .getByPlaceholder(/account compromise/i)
      .fill('e2e suspend ceremony coverage')
    await suspend.getByRole('button', { name: /Initiate Suspension/i }).click()

    const dialog = page.getByRole('dialog', {
      name: /Reason and signature required|Signature Required|Electronic signature/i,
    })
    await expect(dialog).toBeVisible({ timeout: 15_000 })
    await dialog.getByRole('button', { name: /Cancel/i }).click()
    await expect(dialog).toHaveCount(0)
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
      page.locator('#access-review').getByRole('heading', { name: /Report:/i }),
    ).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('#access-review').getByText(/Principals/i).first()).toBeVisible()
  })
})

test.describe('Settings · Seal keys (Admin)', () => {
  test('admin can open Seal keys and see current key + rotation actions', async ({ page }) => {
    await openAdminSettings(page)
    await page.getByRole('link', { name: 'Session cookie keys', exact: true }).click()

    const section = page.locator('#seal-key-rotation')
    await expect(page.getByRole('heading', { name: 'Session cookie keys' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Current Primary Key' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Key Rotation' })).toBeVisible()
    await expect(
      section.getByRole('button', { name: /Perform Normal Rotation/i }),
    ).toBeVisible()
    await expect(
      section.getByRole('button', { name: /Emergency Rotation/i }),
    ).toBeVisible()
    await expect(
      section.getByText(/Key ID|Loading current key|Failed to load current key/i).first(),
    ).toBeVisible({ timeout: 10_000 })
    await expect(section.getByTestId('seal-key-schedule-status')).toBeVisible({
      timeout: 10_000,
    })
    await expect(section.getByTestId('seal-key-ring')).toBeVisible({ timeout: 10_000 })
    await expect(section.getByTestId('seal-key-ring-current')).toContainText(/current/i)
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
        /No IdP baseline is stored|Established|No drift reports yet|Loading IdP drift/i,
      ).first(),
    ).toBeVisible({ timeout: 10_000 })
  })
})
