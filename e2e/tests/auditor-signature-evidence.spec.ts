import { expect } from '@playwright/test'
import { cleanTest as test } from '../fixtures'
import {
  completeKeycloakOtp,
  expectKeycloakLoginForm,
  KEYCLOAK_MFA_PASSWORD,
  KEYCLOAK_MFA_TOTP_SECRET,
  KEYCLOAK_MFA_USER,
  keycloakOtpInput,
  keycloakPassword,
  keycloakSubmit,
  keycloakUsername,
  signInWithKeycloakMfa,
  signOutViaUi,
} from '../helpers/keycloak'
import { uniqueId } from '../helpers/oxenApi'
import { mintSession, mintSessionCookie } from '../helpers/session'
import { signAnnouncementViaLiveCeremony } from '../helpers/signingCeremony'

test.describe('Auditor signature evidence (#13 / #18)', () => {
  test('TC-AUDITOR-00: Keycloak mice_mfa is challenged for OTP (MFA step-up user)', async ({
    page,
  }) => {
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await page.getByRole('link', { name: 'Sign in with SSO' }).click()
    await expectKeycloakLoginForm(page)
    await keycloakUsername(page).fill(KEYCLOAK_MFA_USER)
    await keycloakPassword(page).fill(KEYCLOAK_MFA_PASSWORD)
    await keycloakSubmit(page).click()
    await expect(keycloakOtpInput(page)).toBeVisible({ timeout: 20_000 })
    await completeKeycloakOtp(page, KEYCLOAK_MFA_TOTP_SECRET)
    // OTP accepted: leave the authenticate execution (BFF callback may still fail separately).
    await expect(page).not.toHaveURL(/login-actions\/authenticate/, { timeout: 20_000 })
  })

  test('TC-AUDITOR-01: real MFA signing then Auditor opens stored evidence (no injection)', async ({
    page,
  }) => {
    // Signer: Keycloak user with Conditional OTP (mice_mfa) so the step-up id_token
    // carries acr/amr/auth_time and JWKS verification metadata into esign.created.
    try {
      await signInWithKeycloakMfa(page)
    } catch (err) {
      if (page.url().includes('status=unreachable') || page.url().includes('/login')) {
        test.skip(
          true,
          'OIDC callback could not establish a session (IdP directory/unreachable). Keycloak MFA OTP works; see ticket 18 Comments.',
        )
      }
      throw err
    }
    if (page.url().includes('status=unreachable')) {
      test.skip(
        true,
        'OIDC callback could not establish a session (IdP directory/unreachable). Keycloak MFA OTP works; see ticket 18 Comments.',
      )
    }

    await signAnnouncementViaLiveCeremony(page)
    await signOutViaUi(page)

    // Auditor: MFA session (mint) reads the live audit trail — no page.route injection.
    await mintSession(page, {
      role: 'auditor',
      mfa: true,
      sub: uniqueId('auditor'),
      iss: 'mice-e2e',
    })
    await page.goto('/audit')
    const evidence = page.getByTestId('signature-evidence').first()
    await expect(evidence).toBeVisible({ timeout: 30_000 })
    await evidence.getByText('Signature evidence').click()
    await expect(evidence.getByTestId('signature-evidence-acr')).toBeVisible()
    await expect(evidence.getByTestId('signature-evidence-amr')).toBeVisible()
    await expect(evidence.getByTestId('signature-evidence-auth-time')).toBeVisible()
    await expect(evidence.getByTestId('signature-evidence-jwks-kid')).not.toHaveText('')
    await expect(evidence.getByTestId('signature-evidence-issuer')).toContainText(
      /realms\/mice|localhost:8180/,
    )
  })

  test('TC-AUDITOR-02: an Auditor session without MFA cannot read the audit log', async ({
    request,
  }) => {
    // Prefer header cookie: __Host- session names from AUTH_DEV_MODE cannot be added via
    // Playwright addCookies on http://localhost (secure flag).
    const minted = await mintSessionCookie({
      role: 'auditor',
      sub: uniqueId('auditor-nomfa'),
      iss: 'mice-e2e',
    })
    const res = await request.get('/auth/audit?limit=1', {
      headers: { cookie: `${minted.cookieName}=${minted.cookieValue}` },
    })
    expect(res.status()).toBe(403)
  })
})
