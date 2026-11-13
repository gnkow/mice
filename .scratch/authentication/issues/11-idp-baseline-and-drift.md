Status: done

# 11: IdP baseline, drift report, and disabled-signer alarm

**Spec:** `.specs/01-authentication.md` (R6, T5)

MFA baseline storage is issue 14. Drift classification and the signing block are issue 23. Recording an IdP outage as an incident is issue 46.

## Outcome

The daily drift job also runs `checkDisabledPrincipalsWithSigningRights`. A Principal who is disabled in the directory and still holds sign rights produces a critical access alarm on that run. Baseline failure is visible through the baseline check in issue 14. Drift reports are stored by issue 23.

## Acceptance

- [x] The daily job alarms when a Principal is disabled in the IdP and still has sign rights in Mice
- [x] Baseline check results and drift reports are stored for the validation record

## Code

- `auth/src/authentication/compliance/principalAccessMonitoring.ts`
- `auth/src/authentication/compliance/idpDriftSchedule.ts`
- `auth/src/authentication/compliance/disabledSignerRoutes.ts` (`GET /auth/admin/disabled-signers`)
- `web/src/components/DisabledSignersSection.tsx`

## Comments

2026-11-13 — Checkmate audit: **holds** (disabled-in-IdP + signing-rights alarm via `principalAccessMonitoring.test.ts`; admin list via `disabledSignerRoutes`).

**Deepen (auto-picked):** Collapse check/run/`getIdpStatus` into deep `alarmsFromAccessSnapshots` + `createPrincipalAccessMonitor({ listPrincipals, idpEnabled, hasSigningRights })`. Live wrappers keep the public seam; routes/schedule stay thin.
