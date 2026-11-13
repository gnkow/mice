import { test, expect, openAccountMenu } from '../fixtures'
import { uniqueId } from '../helpers/oxenApi'
import { mintSession } from '../helpers/session'

const signatureEvent = {
  id: 'sig-auditor-13',
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
      jwks_key_id: 'kid-e2e-13',
      token_verified_at: 1_767_225_600_000,
      idp_issuer: 'https://idp.e2e/13',
    },
  },
}

test.describe('Auditor access UI (#13)', () => {
  test('TC-AUDITOR-UI-01: Grant access shows Auditor expiry and MFA constraints', async ({
    page,
  }) => {
    await mintSession(page, { sub: uniqueId('auditor-grant-admin'), role: 'admin' })
    await page.goto('/')
    await openAccountMenu(page)
    await page
      .locator('.profile-menu-panel')
      .getByRole('link', { name: 'Settings' })
      .click()
    await page
      .getByRole('list', { name: 'Access' })
      .getByRole('link', { name: 'Grant access', exact: true })
      .click()

    const section = page.locator('#users-grant')
    await section.getByRole('button', { name: 'Grant Access' }).first().click()
    await section.locator('select').first().selectOption({ label: 'Auditor' })

    await expect(section.getByTestId('auditor-grant-hint')).toBeVisible()
    await expect(section.getByTestId('auditor-grant-hint')).toContainText(
      /always expire|MFA|cannot write/i,
    )
    await expect(section.getByText(/Expires \(required for Auditor\)/i)).toBeVisible()
  })

  test('TC-AUDITOR-UI-02: Audit signature evidence explains MFA verification for auditors', async ({
    page,
  }) => {
    await mintSession(page, {
      role: 'auditor',
      mfa: true,
      sub: uniqueId('auditor-ui-evidence'),
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
    await expect(
      page.getByText(/Signature rows expand to show IdP MFA evidence/i),
    ).toBeVisible()

    const evidence = page.getByTestId('signature-evidence').first()
    await evidence.getByText('Signature evidence').click()
    await expect(
      evidence.getByText(/Auditors use this to prove who signed/i),
    ).toBeVisible()
    await expect(evidence.getByTestId('signature-evidence-acr')).toHaveText('mfa')
    await expect(evidence.getByTestId('signature-evidence-jwks-kid')).toHaveText('kid-e2e-13')
  })
})
