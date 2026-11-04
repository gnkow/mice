import { expect } from '@playwright/test'
import { cleanTest as test } from '../fixtures'
import { uniqueId } from '../helpers/oxenApi'
import { mintSession } from '../helpers/session'

const signatureEvent = {
  id: 'sig-evidence-1',
  seq: 1,
  ts: new Date().toISOString(),
  actor: { sub: 'signer', iss: 'mice-e2e', name: 'Sig Signer', email: 'signer@mice.local' },
  via: 'session',
  method: 'POST',
  path: '/auth/sign/execute',
  status: 200,
  action: 'signature.created',
  action_label: 'Signature created',
  message: 'Electronic signature created: Approved',
  detail: {
    meaning: 'Approved',
    mfaEvidence: { acr: 'mfa', amr: ['pwd', 'otp'], auth_time: 1_700_000_000 },
    verificationMetadata: { jwks_key_id: 'kid-e2e', token_verified_at: 1_767_225_600_000, idp_issuer: 'https://idp.e2e' },
  },
}

test.describe('Auditor signature evidence (#13)', () => {
  test('TC-AUDITOR-01: an Auditor with MFA opens the evidence on a signature event', async ({ page }) => {
    await mintSession(page, { role: 'auditor', mfa: true, sub: uniqueId('auditor'), iss: 'mice-e2e' })
    // The auth gate runs for real; only the signing step-up (needs a live IdP) is injected into the list.
    await page.route('**/auth/audit?*', async (route) => {
      const res = await route.fetch()
      const body = await res.json()
      await route.fulfill({ response: res, json: { ...body, events: [signatureEvent, ...body.events] } })
    })
    await page.goto('/audit')
    const evidence = page.getByTestId('signature-evidence').first()
    await evidence.getByText('Signature evidence').click()
    await expect(evidence).toContainText('mfa')
    await expect(evidence).toContainText('pwd, otp')
    await expect(evidence).toContainText('kid-e2e')
    await expect(evidence).toContainText('https://idp.e2e')
  })

  test('TC-AUDITOR-02: an Auditor session without MFA cannot read the audit log', async ({ page }) => {
    await mintSession(page, { role: 'auditor', sub: uniqueId('auditor-nomfa'), iss: 'mice-e2e' })
    const res = await page.request.get('/auth/audit?limit=1')
    expect(res.status()).toBe(403)
  })
})
