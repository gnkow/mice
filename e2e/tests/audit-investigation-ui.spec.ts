import { expect } from '@playwright/test'
import { cleanTest as test } from '../fixtures'
import { uniqueId } from '../helpers/oxenApi'
import { mintSession } from '../helpers/session'

/**
 * #155 — Audit investigation UI: focus presets, density, evidence in Actions.
 */

const esignEvent = {
  id: 'sig-inv-155',
  seq: 10,
  ts: new Date().toISOString(),
  actor: { sub: 'signer', iss: 'mice-e2e', name: 'Sig Signer', email: 'signer@mice.local' },
  via: 'session',
  method: 'POST',
  path: '/auth/signatures',
  status: 200,
  action: 'esign.created',
  action_label: 'Electronic signature created',
  resource_uri: 'action:esign.created',
  message: 'Signature created',
  signature_id: 'sig-inv-155',
  change: { before: null, after: { signatureId: 'sig-inv-155' } },
  detail: {
    signatureId: 'sig-inv-155',
    meaning: 'Approved',
    signedAt: '2023-11-14T12:00:00.000Z',
    signer: { iss: 'mice-e2e', sub: 'signer', name: 'Sig Signer' },
    mfaEvidence: { acr: 'mfa', amr: ['pwd', 'otp'], auth_time: 1_700_000_000 },
    verificationMetadata: {
      jwks_key_id: 'kid-e2e-155',
      token_verified_at: 1_767_225_600_000,
      idp_issuer: 'https://idp.e2e/155',
    },
  },
}

const fileEvent = {
  id: 'file-inv-155',
  seq: 9,
  ts: new Date(Date.now() - 60_000).toISOString(),
  actor: { sub: 'writer', iss: 'mice-e2e', name: 'File Writer', email: 'writer@mice.local' },
  via: 'session',
  method: 'PUT',
  path: '/api/repos/ns/repo/file/main/a.txt',
  status: 200,
  action: 'file.write',
  action_label: 'File written',
  resource_uri: 'repo:ns/repo#path=a.txt',
  namespace: 'ns',
  repo: 'repo',
  message: 'Wrote a.txt',
  change: { before: { content: 'old' }, after: { content: 'new' } },
  detail: {},
}

test.describe('Audit investigation UI (#155)', () => {
  test('TC-AUDIT-INV-01: Signatures preset filters URL; Evidence opens from Actions', async ({
    page,
  }) => {
    await mintSession(page, {
      role: 'auditor',
      mfa: true,
      sub: uniqueId('auditor-155'),
      iss: 'mice-e2e',
    })

    await page.route('**/auth/audit?*', async (route) => {
      const url = new URL(route.request().url())
      const action = url.searchParams.get('action')
      const res = await route.fetch()
      const body = await res.json()
      const injected =
        action === 'esign'
          ? [esignEvent]
          : action === 'file'
            ? [fileEvent]
            : [esignEvent, fileEvent]
      await route.fulfill({
        response: res,
        json: { ...body, events: injected },
      })
    })

    await page.goto('/audit')
    await expect(page.getByTestId('audit-investigation-presets')).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Actions' })).toBeVisible()

    const signatures = page.getByTestId('audit-preset-signatures')
    await signatures.click()
    await expect(page).toHaveURL(/action=esign/)
    await expect(signatures).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.audit-table')).toContainText('esign.created')
    await expect(page.locator('.audit-table')).not.toContainText('file.write')

    const actionsCell = page.locator('td.audit-col-actions').first()
    const evidence = actionsCell.getByTestId('signature-evidence')
    await expect(evidence).toBeVisible()
    await evidence.getByRole('button', { name: 'Signature evidence' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(evidence.getByTestId('signature-evidence-acr')).toHaveText('mfa')
    await expect(evidence.getByTestId('signature-evidence-jwks-kid')).toHaveText('kid-e2e-155')

    await page.getByTestId('audit-preset-files').click()
    await expect(page).toHaveURL(/action=file/)
    await expect(page.getByTestId('audit-preset-files')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.audit-table')).toContainText('file.write')
    await expect(page.locator('td.audit-col-actions').first().getByTestId('signature-evidence')).toHaveCount(
      0,
    )
  })
})
