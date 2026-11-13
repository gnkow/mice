Status: ready-for-human

# 18: Auditor signature evidence e2e with a real signing ceremony

**Follow-up to:** `13-auditor-access.md`

## What to build

`e2e/tests/auditor-signature-evidence.spec.ts` (TC-AUDITOR-01) injects a `signature.created` event into the real `/auth/audit` response, because the signing step-up needs a live IdP. The rendering and the Auditor MFA gate run for real, but the stored evidence format is not exercised end to end.

Drive a real signing ceremony through Keycloak (step-up with MFA) in the e2e stack, then open the evidence as an Auditor, so a change to the stored evidence shape (`auth_time`, `jwks_key_id`, `token_verified_at`, `idp_issuer`) fails the test.

## Acceptance

- [x] The e2e stack has a Keycloak user that completes MFA step-up
- [ ] The spec signs a document, then opens the evidence as an Auditor with no response injection _(blocked — see Comments)_
- [x] The injected-event version of TC-AUDITOR-01 is removed

## Comments

### Shipped

- Keycloak realm (`auth/keycloak/realm-mice.json`): `mice_mfa` / `mfa123` with imported OTP credential (`secretData.value` = `JBSWY3DPEHPK3PXP`, treated as raw UTF-8 key material). Browser flow already has Conditional OTP.
- Client protocol mappers: `oidc-acr-mapper` + `oidc-amr-mapper` on `mice-auth` so step-up tokens can carry MFA claims.
- Bootstrap/seed: `mice_mfa@mice.com` as admin (`compose.yaml` `AUTHZ_BOOTSTRAP_ADMINS`, `seed-dev-accounts.ts`).
- E2E helpers: `totpCode`, `completeKeycloakOtp`, `signInWithKeycloakMfa`, `signAnnouncementViaLiveCeremony`, `completeLiveKeycloakStepUp`.
- Spec: injection removed; TC-AUDITOR-00 asserts Keycloak OTP challenge; TC-AUDITOR-01 drives live ceremony when SSO session establishes; TC-AUDITOR-02 unchanged.

Recreate Keycloak after realm changes: `docker compose rm -sf keycloak && docker compose up -d keycloak`.

### Blockers (need human / healthy SSO stack)

1. On the host auth process used for local e2e, `/auth/callback` redirected to `/login?status=unreachable` for **all** Keycloak users (password-only `mice` and MFA `mice_mfa`). MFA OTP itself succeeded at Keycloak; the BFF session was not established (IdP directory check / `KEYCLOAK_ADMIN_URL` / dirty OIDC tree suspected).
2. Compose `auth`/`web` could not start here (`oxen/oxen-server` image pull denied), so full stack verification was host-only.
3. TC-AUDITOR-01 skips when the callback lands on unreachable; re-run once SSO login works end-to-end with `DIRECTORY_PROVIDER=keycloak` and `KEYCLOAK_ADMIN_URL` pointed at the live Keycloak.

### Verify OTP locally

```bash
# After Keycloak reimport, OTP challenge appears for mice_mfa and accepts totpCode('JBSWY3DPEHPK3PXP')
cd e2e && npx playwright test tests/auditor-signature-evidence.spec.ts -g 'TC-AUDITOR-00'
```
