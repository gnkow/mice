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
import {
  decideLiveSigningCeremony,
  initialCeremonyBudget,
  type CeremonyGate,
  type CeremonyPhase,
} from './liveSigningCeremonyDecide'

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
    page.getByRole('dialog', { name: /Signature Required/i }),
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
 * Drive the live Keycloak step-up (password + TOTP for mice_admin) from a signing
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

const LIVE_CEREMONY_REASON =
  'E2E auditor signature evidence with live MFA ceremony'

async function fillReasonAndReview(page: Page, reason: string): Promise<void> {
  const reasonDialog = page.getByRole('dialog', { name: /Reason and signature required/i })
  await expect(reasonDialog).toBeVisible({ timeout: 15_000 })
  await reasonDialog.getByLabel('Reason').fill(reason)
  await reasonDialog.getByRole('button', { name: /Review signature/i }).click()
}

async function observeCeremonyGate(page: Page, waitMs: number): Promise<CeremonyGate> {
  const interstitial = page.getByTestId('signing-challenge-interstitial')
  const signDialog = page.getByRole('dialog', { name: /Electronic signature/i })
  if (waitMs > 0) {
    await expect(interstitial.or(signDialog))
      .toBeVisible({ timeout: waitMs })
      .catch(() => undefined)
  }
  if (await interstitial.isVisible().catch(() => false)) return 'interstitial'
  if (await signDialog.isVisible().catch(() => false)) return 'sign'
  return 'absent'
}

async function clickSignAndContinue(page: Page): Promise<void> {
  const signDialog = page.getByRole('dialog', { name: /Electronic signature/i })
  await expect(signDialog).toBeVisible({ timeout: 20_000 })
  await signDialog.getByRole('button', { name: /Sign and continue/i }).click()
}

async function ceremonyDialogVisible(page: Page): Promise<boolean> {
  return page
    .getByRole('dialog', { name: /Electronic signature|Reason and signature/i })
    .isVisible()
    .catch(() => false)
}

/**
 * Drive reason → step-up gates → Sign until `success` is visible.
 * Owns retry after step-up when the dialog was dismissed; callers supply trigger + success.
 */
export async function runLiveSigningCeremony(
  page: Page,
  opts: {
    trigger: () => Promise<void>
    success: Locator
    reason?: string
  },
): Promise<void> {
  const reason = opts.reason ?? LIVE_CEREMONY_REASON
  let phase: CeremonyPhase = 'after_trigger'
  let budget = initialCeremonyBudget()
  let pendingTrigger = true

  for (let i = 0; i < 24; i++) {
    if (await opts.success.isVisible().catch(() => false)) return

    const gateWait =
      phase === 'awaiting_gate' ? 20_000 : phase === 'after_sign' ? 3_000 : 0
    const gate = await observeCeremonyGate(page, gateWait)
    const dialogLost =
      phase === 'after_step_up' ? !(await ceremonyDialogVisible(page)) : false
    const successVisible = await opts.success.isVisible().catch(() => false)

    const decision = decideLiveSigningCeremony({
      phase,
      gate,
      dialogLost,
      successVisible,
      budget,
    })
    phase = decision.phase
    budget = decision.budget

    switch (decision.command.op) {
      case 'fill_reason':
        if (pendingTrigger) {
          await opts.trigger()
          pendingTrigger = false
        }
        await fillReasonAndReview(page, reason)
        break
      case 'step_up':
        await completeLiveKeycloakStepUp(page)
        break
      case 'click_sign':
        await clickSignAndContinue(page)
        break
      case 'retrigger':
        pendingTrigger = true
        break
      case 'done':
        await expect(opts.success).toBeVisible({ timeout: 30_000 })
        return
      case 'fail':
        throw new Error(decision.command.reason)
    }
  }
  throw new Error('Live signing ceremony loop exceeded iteration budget')
}

/**
 * Drive a real reason + signing ceremony via seal-key normal rotation (no response injection).
 * Announcements do not require a signature; seal-key rotate does and records `esign.created`.
 * Caller must already be signed in as an admin who can complete Keycloak MFA step-up.
 *
 * Clears Playwright's suite-wide `x-mice-reason` extra header for the ceremony so the signed
 * document reason matches the retry headers (otherwise the BFF returns signature_invalid).
 */
export async function signViaLiveSealKeyRotation(page: Page): Promise<void> {
  const baseURL = process.env.MICE_BASE_URL ?? 'http://localhost:5173'
  const ctx = page.context()
  await ctx.setExtraHTTPHeaders({ origin: baseURL })

  try {
    await page.goto('/settings')
    await page.getByRole('link', { name: 'Session cookie keys', exact: true }).click()
    const section = page.locator('#seal-key-rotation')
    const rotate = section.getByRole('button', { name: /Perform Normal Rotation/i })
    await expect(rotate).toBeVisible()

    await runLiveSigningCeremony(page, {
      trigger: async () => {
        await rotate.click()
      },
      success: section.getByText(/Normal rotation completed/i),
    })
  } finally {
    await ctx.setExtraHTTPHeaders({
      'x-mice-reason': 'e2e: automated test change',
      origin: baseURL,
    })
  }
}

/** @deprecated Prefer signViaLiveSealKeyRotation — announcements are not signature-gated. */
export const signAnnouncementViaLiveCeremony = signViaLiveSealKeyRotation

// Re-export MFA login for ceremony callers that need a full SSO path.
export { completeKeycloakLogin, KEYCLOAK_MFA_USER }
