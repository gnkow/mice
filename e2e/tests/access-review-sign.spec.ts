import { expect, openAccountMenu } from '../fixtures'
import { cleanTest as test } from '../fixtures'
import { uniqueId } from '../helpers/oxenApi'
import { mintSession } from '../helpers/session'

test.describe('Access review sign (#40)', () => {
  test('admin opens Access review via Settings nav and sees Sign report flow', async ({
    page,
  }) => {
    await mintSession(page, {
      sub: uniqueId('ar-sign'),
      role: 'admin',
      mfa: true,
      iss: 'mice-e2e',
    })
    await page.goto('/')
    await openAccountMenu(page)
    await page
      .locator('.profile-menu-panel')
      .getByRole('link', { name: 'Settings' })
      .click()

    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
    await page.getByRole('link', { name: 'Access review', exact: true }).click()

    const section = page.locator('#access-review')
    await expect(
      section.getByRole('heading', { name: /Quarterly Access Review/i }),
    ).toBeVisible()

    const quarter = `2099-Q${(Date.now() % 4) + 1}`
    await section.getByLabel('Quarter').fill(quarter)

    await page.route('**/auth/admin/access-review/generate', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          report: {
            reportId: `e2e-${quarter}`,
            quarter,
            generatedAt: Date.now(),
            principals: [],
          },
          contentHash: 'e2e-hash-ready',
        }),
      })
    })
    await section.getByRole('button', { name: /Generate Report/i }).click()

    await expect(section.getByRole('heading', { name: `Report: ${quarter}` })).toBeVisible({
      timeout: 15_000,
    })
    await expect(
      section.getByText(/Awaiting an instance admin signature/i),
    ).toBeVisible()

    const signButton = section.getByRole('button', { name: /Sign report|Signing/i })
    await expect(signButton).toBeVisible()
    await expect(signButton).toBeEnabled()

    // Deterministic sign success path for confirm feedback (ceremony may need reauth in mintSession).
    await page.route('**/auth/admin/access-review/sign', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          report: {
            reportId: `e2e-${quarter}`,
            quarter,
            generatedAt: Date.now(),
            principals: [],
            reviewerSignature: {
              hash: 'e2e-hash',
              principal: { iss: 'mice-e2e', sub: 'ar-sign', name: 'E2E Signer' },
              signedAt: Date.now(),
              meaning: 'Reviewed',
              content: '{}',
            },
          },
          contentHash: 'e2e-hash',
        }),
      })
    })

    await signButton.click()
    await expect(section.getByRole('status').filter({ hasText: /Signed as Reviewed/i })).toBeVisible({
      timeout: 10_000,
    })
    await expect(section.getByTestId('access-review-signature')).toBeVisible()
  })

  test('sign failure shows accessible alert', async ({ page }) => {
    await mintSession(page, {
      sub: uniqueId('ar-sign-err'),
      role: 'admin',
      mfa: true,
      iss: 'mice-e2e',
    })
    await page.goto('/')
    await openAccountMenu(page)
    await page
      .locator('.profile-menu-panel')
      .getByRole('link', { name: 'Settings' })
      .click()
    await page.getByRole('link', { name: 'Access review', exact: true }).click()

    const section = page.locator('#access-review')
    const quarter = `2098-Q${(Date.now() % 4) + 1}`
    await section.getByLabel('Quarter').fill(quarter)

    await page.route(`**/auth/admin/access-review/generate`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          report: {
            reportId: `e2e-${quarter}`,
            quarter,
            generatedAt: Date.now(),
            principals: [{ principal: { iss: 'mice-e2e', sub: 'x', name: 'X' }, roles: [], grants: [] }],
          },
          contentHash: 'hash-1',
        }),
      })
    })
    await section.getByRole('button', { name: /Generate Report/i }).click()
    await expect(section.getByRole('button', { name: /Sign report/i })).toBeVisible()

    await page.route('**/auth/admin/access-review/sign', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'reauthentication_required',
          reauthUrl: '/auth/reauth?max_age=60&next=%2Fsettings',
        }),
      })
    })
    await section.getByRole('button', { name: /Sign report/i }).click()
    const interstitial = page.getByTestId('signing-challenge-interstitial')
    await expect(interstitial).toBeVisible()
    await expect(interstitial.getByRole('heading', { name: /Confirm it's you/i })).toBeVisible()
    await expect(interstitial.getByRole('alert')).toContainText(/fresh sign-in/i)
    await expect(interstitial.getByTestId('signing-challenge-continue')).toBeVisible()
  })
})
