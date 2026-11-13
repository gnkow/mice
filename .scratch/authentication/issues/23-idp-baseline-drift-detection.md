Status: done

# 23: IdP baseline drift detection

**Spec:** `.specs/01-authentication.md` (U20, T5)

The deploy-time MFA check is issue 14. An IdP outage incident record is issue 46.

## Outcome

`idp_baseline` stores MFA claim availability, required scopes, signature algorithm, group-claim format, and issuer. A daily job started from boot fetches OIDC discovery, compares it with the current baseline, and stores `idp_drift_reports`. Critical drift (MFA missing, algorithm changed, issuer changed) makes `POST /auth/sign/execute` return 503 with the report id. Non-critical drift (group format, expanded scopes) is logged and does not block signing. Admins can view the baseline, compare, run a check, read reports, and establish a new baseline.

## Acceptance

- [x] The baseline stores MFA availability, scopes, signature algorithm, group-claim format, and issuer
- [x] A daily check compares discovery with the baseline and stores the report
- [x] Critical drift blocks signing with 503 and the report id
- [x] Non-critical drift is recorded and does not block signing
- [x] Admins can inspect, check, and replace the baseline

## Code

- `auth/src/authentication/compliance/idpDriftDetection.ts`
- `auth/src/authentication/compliance/idpDriftSchedule.ts`
- `auth/src/authentication/compliance/idpDriftRoutes.ts`
- `auth/src/boot.ts`
- `auth/src/authentication/signing/signingRoutes.ts`
- `web/src/components/IdpDriftSection.tsx`

## Comments

2026-11-13 — Checkmate audit: **holds** (baseline fields, daily store, critical 503 block, non-critical log, admin inspect/check/replace via `idpDriftDetection.test.ts` + routes/signing).

**Deepen (auto-picked):** Unify compare+persist behind `assessDrift({ persist, fetchDiscovery })` (one `storeDriftReport`); schedule timer delegates to `runIdpDriftTick` + `logDriftReport`.
