import { expect } from '../fixtures'
import { cleanTest as test } from '../fixtures'
import { uniqueId } from '../helpers/oxenApi'
import { mintSession } from '../helpers/session'
import {
  expectSigningChallenge,
  openAccessReviewForSign,
  openReasonPromptViaAnnouncement,
} from '../helpers/signingCeremony'

test.describe('09 step-up reauthentication UI', () => {
  test('access review sign shows Confirm it’s you interstitial before redirect', async ({
    page,
  }) => {
    await mintSession(page, {
      sub: uniqueId('ar-09'),
      role: 'admin',
      mfa: true,
      iss: 'mice-e2e',
    })
    const quarter = `2097-Q${(Date.now() % 4) + 1}`
    const section = await openAccessReviewForSign(page, quarter)

    await page.route('**/auth/admin/access-review/sign', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'reauthentication_required',
          maxAge: 60,
          reauthUrl: '/auth/reauth?max_age=60&next=%2Fsettings',
        }),
      })
    })

    await section.getByRole('button', { name: /Sign report/i }).click()
    await expectSigningChallenge(page, /Confirm it's you/i, 'step_up', /fresh sign-in/i)

    // Continue is the CTA; do not navigate away silently without the interstitial.
    await expect(page).toHaveURL(/settings|access/i)
  })

  test('reason prompt prepare shows Confirm it’s you instead of silent redirect', async ({
    page,
  }) => {
    await mintSession(page, {
      sub: uniqueId('rp-09'),
      role: 'admin',
      mfa: true,
      iss: 'mice-e2e',
    })
    await openReasonPromptViaAnnouncement(page)

    await page.route('**/auth/sign/prepare-mutation', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'reauthentication_required',
          maxAge: 60,
          reauthUrl: '/auth/reauth?max_age=60&next=%2Fsettings',
        }),
      })
    })

    const dialog = page.getByRole('dialog', { name: /Reason and signature required/i })
    await dialog.getByLabel('Reason').fill('E2E step-up interstitial check for regulated publish')
    await dialog.getByRole('button', { name: /Review signature/i }).click()

    await expectSigningChallenge(page, /Confirm it's you/i, 'step_up')
    await expect(page.getByTestId('signing-challenge-continue')).toBeEnabled()
  })
})
