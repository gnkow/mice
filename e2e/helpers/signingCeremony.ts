import { expect, type Locator, type Page } from '@playwright/test'
import { openAccountMenu } from '../fixtures'

/** Open Settings → Access review and generate a stubbed unsigned report. */
export async function openAccessReviewForSign(
  page: Page,
  quarter: string,
): Promise<Locator> {
  await page.goto('/')
  await openAccountMenu(page)
  await page
    .locator('.profile-menu-panel')
    .getByRole('link', { name: 'Settings' })
    .click()
  await page.getByRole('link', { name: 'Access review', exact: true }).click()

  const section = page.locator('#access-review')
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
          principals: [
            {
              principal: { iss: 'mice-e2e', sub: 'x', name: 'X' },
              roles: [],
              grants: [],
            },
          ],
        },
        contentHash: 'hash-1',
      }),
    })
  })
  await section.getByRole('button', { name: /Generate Report/i }).click()
  await expect(section.getByRole('button', { name: /Sign report/i })).toBeVisible()
  return section
}

/** Stub announcement publish so the reason/signature dialog opens. */
export async function openReasonPromptViaAnnouncement(page: Page): Promise<void> {
  await page.goto('/settings')
  await expect(page.getByRole('link', { name: 'Announcements' })).toBeVisible()

  await page.route('**/auth/announcements', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        error: 'An electronic signature is required for this change',
        code: 'signature_required',
      }),
    })
  })

  const section = page.locator('#announcements')
  await section.getByLabel('Title').fill(`Sign challenge ${Date.now()}`)
  await section.getByLabel('Severity').selectOption('info')
  await section.getByLabel('Message').fill('Trigger signing ceremony for E2E')
  await section.getByRole('button', { name: 'Publish announcement' }).click()

  await expect(
    page.getByRole('dialog', { name: /Reason and signature required/i }),
  ).toBeVisible()
}

export async function expectSigningChallenge(
  page: Page,
  title: RegExp | string,
  kind: 'step_up' | 'session_idle' | 'mfa_required',
  message?: RegExp,
) {
  const interstitial = page.getByTestId('signing-challenge-interstitial')
  await expect(interstitial).toBeVisible()
  await expect(interstitial).toHaveAttribute('data-challenge-kind', kind)
  await expect(interstitial.getByRole('heading', { name: title })).toBeVisible()
  const alert = interstitial.getByRole('alert')
  await expect(alert).toBeVisible()
  if (message) await expect(alert).toContainText(message)
  await expect(interstitial.getByTestId('signing-challenge-continue')).toBeVisible()
  return interstitial
}
