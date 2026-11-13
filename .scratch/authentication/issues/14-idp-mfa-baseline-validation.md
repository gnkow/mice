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
- `auth/src/authentication/compliance/idpBaseline.ts`
- `web/src/pages/SettingsPage.tsx`

## Comments

2026-11-13 — Checkmate audit: **holds** (MFA refusal + baseline store/status covered by `mfaEvidence` / signing evidence / `idpBaselineRoutes`).

**Deepen (auto-picked):** Collapse claim extract → storeable baseline result into `evaluateIdpMfaBaseline`; admin check evaluates the Session id_token through that seam. `checkIdpBaselineFromClaims` folds MFA evidence into the compliance checklist.

**Files:** `mfaEvidence.ts`, `mfaEvidence.test.ts`, `admin/idpBaselineRoutes.ts`, `compliance/idpBaseline.ts`, `idpBaseline.test.ts`

2026-11-13 — **Deepen #2 (auto-picked):** Collapse decode → evaluate → persist into `recordIdpBaselineCheck`; admin POST is an HTTP/audit adapter. Did not touch signingRoutes.
**Seams:** `admin/idpBaselineCheck.ts` (`recordIdpBaselineCheck`); `evaluateIdpMfaBaseline` remains the pure claims decision.
**Tests:** `idpBaselineCheck.test.ts` + `mfaEvidence.test.ts` (unit), `idpBaselineRoutes.test.ts` (integ, stores MFA-available check).

2026-11-13: deep-api Deepen (holds) — auto-picked Top architecture recommendation; unit+integration strengthened at ticket seams; Status remains done.
