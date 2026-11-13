import { expect } from '../fixtures'
import { cleanTest as test } from '../fixtures'
import { uniqueId } from '../helpers/oxenApi'
import { mintSession } from '../helpers/session'
import {
  expectSigningChallenge,
  openAccessReviewForSign,
  openReasonPromptViaAnnouncement,
} from '../helpers/signingCeremony'

test.describe('20 idle timeout at signing UI', () => {
  test('access review sign shows Session idle interstitial', async ({ page }) => {
    await mintSession(page, {
      sub: uniqueId('ar-20'),
      role: 'admin',
      mfa: true,
      iss: 'mice-e2e',
    })
    const quarter = `2096-Q${(Date.now() % 4) + 1}`
    const section = await openAccessReviewForSign(page, quarter)

    await page.route('**/auth/admin/access-review/sign', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'session_idle',
          message: 'Session idle for 20+ minutes, re-authenticate required',
          idleMinutes: 20,
          maxIdleMinutes: 15,
        }),
      })
    })

    await section.getByRole('button', { name: /Sign report/i }).click()
    await expectSigningChallenge(page, /Session idle/i, 'session_idle', /idle/i)
  })

  test('reason prompt prepare shows Session idle interstitial', async ({ page }) => {
    await mintSession(page, {
      sub: uniqueId('rp-20'),
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
          error: 'session_idle',
          message: 'Session idle for 30+ minutes, re-authenticate required',
        }),
      })
    })

    const dialog = page.getByRole('dialog', { name: /Reason and signature required/i })
    await dialog.getByLabel('Reason').fill('E2E idle timeout interstitial for regulated publish')
    await dialog.getByRole('button', { name: /Review signature/i }).click()

    await expectSigningChallenge(page, /Session idle/i, 'session_idle')
  })
})
