import { expect } from '@playwright/test'
import { cleanTest as test } from '../fixtures'
import { uniqueId } from '../helpers/oxenApi'
import { mintSession } from '../helpers/session'

/**
 * Ticket 26 — Signature evidence metadata (acr / amr / auth_time / JWKS) on AuditPage.
 */

const signatureEvent = {
  id: 'sig-meta-26',
  seq: 1,
  ts: new Date().toISOString(),
  actor: { sub: 'signer', iss: 'mice-e2e', name: 'Sig Signer', email: 'signer@mice.local' },
  via: 'session',
  method: 'POST',
  path: '/auth/sign/execute',
  status: 200,
  action: 'esign.created',
  action_label: 'Electronic signature recorded',
  message: 'Electronic signature created: Approved',
  detail: {
    meaning: 'Approved',
    mfaEvidence: { acr: 'mfa', amr: ['pwd', 'otp'], auth_time: 1_700_000_000 },
    verificationMetadata: {
      jwks_key_id: 'kid-e2e-26',
      token_verified_at: 1_767_225_600_000,
      idp_issuer: 'https://idp.e2e/26',
    },
  },
}

test.describe('Signature evidence metadata (#26)', () => {
  test('TC-26-01: AuditPage shows acr, amr, auth_time, and JWKS fields when present', async ({
    page,
  }) => {
    await mintSession(page, {
      role: 'auditor',
      mfa: true,
      sub: uniqueId('auditor-26'),
      iss: 'mice-e2e',
    })
    await page.route('**/auth/audit?*', async (route) => {
      const res = await route.fetch()
      const body = await res.json()
      await route.fulfill({
        response: res,
        json: { ...body, events: [signatureEvent, ...body.events] },
      })
    })

    await page.goto('/audit')
    const evidence = page.getByTestId('signature-evidence').first()
    await evidence.getByText('Signature evidence').click()

    await expect(evidence.getByTestId('signature-evidence-acr')).toHaveText('mfa')
    await expect(evidence.getByTestId('signature-evidence-amr')).toHaveText('pwd, otp')
    await expect(evidence.getByTestId('signature-evidence-auth-time')).toBeVisible()
    await expect(evidence.getByTestId('signature-evidence-auth-time')).toContainText('2023-11-14')
    await expect(evidence.getByTestId('signature-evidence-jwks-kid')).toHaveText('kid-e2e-26')
    await expect(evidence.getByTestId('signature-evidence-verified-at')).toBeVisible()
    await expect(evidence.getByTestId('signature-evidence-issuer')).toHaveText(
      'https://idp.e2e/26',
    )
    await expect(evidence.locator('[data-evidence-label="Auth context (acr)"]')).toBeVisible()
    await expect(evidence.locator('[data-evidence-label="JWKS key id"]')).toBeVisible()
  })
})
