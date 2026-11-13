import { expect } from '../fixtures'
import { cleanTest as test } from '../fixtures'
import { uniqueId } from '../helpers/oxenApi'
import { mintSession } from '../helpers/session'
import {
  expectSigningChallenge,
  openAccessReviewForSign,
  openReasonPromptViaAnnouncement,
} from '../helpers/signingCeremony'

test.describe('52 verified signing evidence UI', () => {
  test('access review sign shows MFA required when evidence incomplete', async ({
    page,
  }) => {
    await mintSession(page, {
      sub: uniqueId('ar-52'),
      role: 'admin',
      mfa: true,
      iss: 'mice-e2e',
    })
    const quarter = `2095-Q${(Date.now() % 4) + 1}`
    const section = await openAccessReviewForSign(page, quarter)

    await page.route('**/auth/admin/access-review/sign', async (route) => {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'MFA required for electronic signature',
          reason: 'acr_missing',
        }),
      })
    })

    await section.getByRole('button', { name: /Sign report/i }).click()
    await expectSigningChallenge(
      page,
      /MFA required/i,
      'mfa_required',
      /acr missing|multi-factor/i,
    )
  })

  test('reason prompt execute shows MFA required for incomplete evidence', async ({
    page,
  }) => {
    await mintSession(page, {
      sub: uniqueId('rp-52'),
      role: 'admin',
      mfa: true,
      iss: 'mice-e2e',
    })
    await openReasonPromptViaAnnouncement(page)

    await page.route('**/auth/sign/prepare-mutation', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          content: '{"v":1}',
          hash: 'abc123',
          action: 'privileged_settings',
          meaning: 'Approved',
          principal: { iss: 'mice-e2e', sub: 'rp-52', name: 'E2E' },
        }),
      })
    })
    await page.route('**/auth/sign/execute', async (route) => {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'MFA required for electronic signature',
          reason: 'amr_missing',
        }),
      })
    })

    const dialog = page.getByRole('dialog', { name: /Reason and signature required/i })
    await dialog.getByLabel('Reason').fill('E2E MFA evidence interstitial for regulated publish')
    await dialog.getByRole('button', { name: /Review signature/i }).click()

    await expect(
      page.getByRole('dialog', { name: /Electronic signature/i }),
    ).toBeVisible()
    await page.getByRole('button', { name: /Sign and continue/i }).click()

    await expectSigningChallenge(
      page,
      /MFA required/i,
      'mfa_required',
      /amr missing|multi-factor/i,
    )
  })
})
