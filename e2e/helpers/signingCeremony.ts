import { expect, type Locator, type Page } from '@playwright/test'
import { openAccountMenu } from '../fixtures'
import {
  completeKeycloakLogin,
  completeKeycloakOtp,
  KEYCLOAK_MFA_PASSWORD,
  KEYCLOAK_MFA_TOTP_SECRET,
  KEYCLOAK_MFA_USER,
  keycloakOtpInput,
  keycloakPassword,
  keycloakSubmit,
  keycloakUsername,
} from './keycloak'

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

/**
 * Drive the live Keycloak step-up (password + TOTP for mice_mfa) from a signing
 * challenge interstitial, then return to Mice.
 */
export async function completeLiveKeycloakStepUp(page: Page): Promise<void> {
  const continueBtn = page.getByTestId('signing-challenge-continue')
  if (await continueBtn.isVisible().catch(() => false)) {
    await continueBtn.click()
  }
  await expect(page).toHaveURL(/8180|\/realms\/mice\/|openid-connect\/auth/, {
    timeout: 20_000,
  })
  // Fresh authorize may show password and/or OTP depending on Keycloak session.
  if (await keycloakUsername(page).isVisible().catch(() => false)) {
    await keycloakUsername(page).fill(KEYCLOAK_MFA_USER)
    await keycloakPassword(page).fill(KEYCLOAK_MFA_PASSWORD)
    await keycloakSubmit(page).click()
  }
  if (await keycloakOtpInput(page).isVisible().catch(() => false)) {
    await completeKeycloakOtp(page, KEYCLOAK_MFA_TOTP_SECRET)
  } else if (await keycloakPassword(page).isVisible().catch(() => false)) {
    // Password-only prompt without username (SSO session hint).
    await keycloakPassword(page).fill(KEYCLOAK_MFA_PASSWORD)
    await keycloakSubmit(page).click()
    if (await keycloakOtpInput(page).isVisible().catch(() => false)) {
      await completeKeycloakOtp(page, KEYCLOAK_MFA_TOTP_SECRET)
    }
  }
  await expect(page).toHaveURL(/localhost:5173|127\.0\.0\.1:5173/, { timeout: 30_000 })
  await expect(page).not.toHaveURL(/8180|openid-connect/, { timeout: 30_000 })
}

/**
 * Publish an announcement through the real reason + signing ceremony (no response injection).
 * Caller must already be signed in as an admin who can complete Keycloak MFA step-up.
 */
export async function signAnnouncementViaLiveCeremony(page: Page): Promise<void> {
  await page.goto('/settings')
  await page.getByRole('link', { name: 'Announcements' }).click()
  const section = page.locator('#announcements')
  const title = `Auditor evidence ${Date.now()}`
  await section.getByLabel('Title').fill(title)
  await section.getByLabel('Severity').selectOption('info')
  await section.getByLabel('Message').fill('Real Keycloak MFA signing for auditor evidence e2e')
  await section.getByRole('button', { name: 'Publish announcement' }).click()

  const reasonDialog = page.getByRole('dialog', { name: /Reason and signature required/i })
  await expect(reasonDialog).toBeVisible({ timeout: 15_000 })
  await reasonDialog.getByLabel('Reason').fill('E2E auditor signature evidence with live MFA ceremony')
  await reasonDialog.getByRole('button', { name: /Review signature/i }).click()

  // Step-up interstitial or immediate Keycloak redirect.
  const interstitial = page.getByTestId('signing-challenge-interstitial')
  if (await interstitial.isVisible().catch(() => false)) {
    await completeLiveKeycloakStepUp(page)
    // After reauth, re-open the ceremony if the UI returned to settings.
    if (!(await page.getByRole('dialog', { name: /Electronic signature|Reason and signature/i }).isVisible().catch(() => false))) {
      await section.getByRole('button', { name: 'Publish announcement' }).click()
      const again = page.getByRole('dialog', { name: /Reason and signature required/i })
      if (await again.isVisible().catch(() => false)) {
        await again.getByLabel('Reason').fill('E2E auditor signature evidence with live MFA ceremony')
        await again.getByRole('button', { name: /Review signature/i }).click()
      }
    }
  }

  const signDialog = page.getByRole('dialog', { name: /Electronic signature/i })
  if (await signDialog.isVisible().catch(() => false)) {
    await signDialog.getByRole('button', { name: /Sign and continue/i }).click()
  }

  // Another step-up may fire at execute.
  if (await interstitial.isVisible().catch(() => false)) {
    await completeLiveKeycloakStepUp(page)
  }
  if (await page.getByRole('dialog', { name: /Electronic signature/i }).isVisible().catch(() => false)) {
    await page.getByRole('button', { name: /Sign and continue/i }).click()
  }

  await expect(page.getByText(title).first()).toBeVisible({ timeout: 30_000 })
}

// Re-export MFA login for ceremony callers that need a full SSO path.
export { completeKeycloakLogin, KEYCLOAK_MFA_USER }
