Status: done

# 14: IdP MFA baseline validation

**Spec:** `.specs/01-authentication.md` (U1)

Daily comparison of the IdP against the stored baseline is issue 23.

## Outcome

Signing reads `acr` and `amr` from the step-up id_token. Missing MFA evidence returns 403 `signature.mfa_required`. Admins can run a baseline check that records whether the IdP presented MFA claims. Results are stored in `idp_baseline_checks`. The settings page shows the latest check.

## Acceptance

- [x] Signing is refused when `acr`/`amr` do not show MFA
- [x] An admin can run a baseline check and see the last result
- [x] Check results (time, MFA available, claims found) are stored

## Code

- `auth/src/authentication/signing/mfaEvidence.ts`
- `auth/src/authentication/signing/signingRoutes.ts`
- `auth/src/authentication/admin/idpBaselineRoutes.ts`
- `web/src/pages/SettingsPage.tsx`
