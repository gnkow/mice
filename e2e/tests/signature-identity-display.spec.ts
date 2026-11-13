import { expect } from '@playwright/test'
import { cleanTest as test } from '../fixtures'
import { uniqueId } from '../helpers/oxenApi'
import { mintSession } from '../helpers/session'

/**
 * Ticket 53 — Signature identity snapshot + nowKnownAs on signature views.
 */

const signatureEvent = {
  id: 'sig-identity-1',
  seq: 1,
  ts: new Date().toISOString(),
  actor: { sub: 'signer', iss: 'mice-e2e', name: 'Dr. Jane Smith', email: 'signer@mice.local' },
  via: 'session',
  method: 'POST',
  path: '/auth/sign/execute',
  status: 200,
  action: 'esign.created',
  action_label: 'Electronic signature recorded',
  message: 'Electronic signature created: Approved',
  detail: {
    meaning: 'Approved',
    signedAt: '2021-03-15T12:00:00.000Z',
    signer: { iss: 'mice-e2e', sub: 'signer', name: 'Dr. Jane Smith' },
    nowKnownAs: 'Dr. Jane Jones',
    mfaEvidence: { acr: 'mfa', amr: ['pwd', 'otp'], auth_time: 1_700_000_000 },
    verificationMetadata: {
      jwks_key_id: 'kid-e2e',
      token_verified_at: 1_767_225_600_000,
      idp_issuer: 'https://idp.e2e',
    },
  },
}

test.describe('Signature identity display (#53)', () => {
  test('TC-53-01: audit signature evidence shows snapshot and now known as', async ({
    page,
  }) => {
    await mintSession(page, {
      role: 'auditor',
      mfa: true,
      sub: uniqueId('auditor-id'),
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
    await expect(evidence).toContainText('Dr. Jane Smith')
    await expect(evidence).toContainText('mice-e2e')
    await expect(evidence).toContainText('signer')
    await expect(evidence.getByTestId('signature-now-known-as')).toHaveText('Dr. Jane Jones')
    await expect(evidence).toContainText('mfa')
  })

  test('TC-53-02: access-review signature uses now-known-as wording', async ({ page }) => {
    const iss = 'mice-e2e'
    const sub = uniqueId('ar-id')
    await mintSession(page, { role: 'admin', sub, iss, name: 'Dr. Jane Jones' })

    await page.route('**/auth/admin/access-review/overdue', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', json: { overdue: [] } })
    })
    await page.route('**/auth/admin/access-review/**', async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        json: {
          report: {
            reportId: 'r53',
            quarter: '2026-Q2',
            generatedAt: Date.now(),
            principals: [],
            reviewerSignature: {
              hash: 'h53',
              principal: { iss, sub, name: 'Dr. Jane Smith' },
              signedAt: Date.UTC(2021, 2, 15),
              meaning: 'Approved',
              content: '{}',
            },
          },
          contentHash: 'hash53',
        },
      })
    })
    await page.route('**/auth/admin/principals/names?*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        json: { currentName: 'Dr. Jane Jones', history: [] },
      })
    })

    await page.goto('/settings')
    const accessReview = page.locator('#access-review')
    await accessReview.scrollIntoViewIfNeeded()
    await accessReview.getByRole('button', { name: 'Open stored report' }).click()
    await expect(page.getByTestId('signature-now-known-as')).toContainText(
      'Now known as: Dr. Jane Jones',
    )
    await expect(page.getByTestId('access-review-signature')).not.toContainText('currently:')
  })
})
