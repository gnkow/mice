# 50: Startup IdP assurance gate

**What to build:** The instance refuses to start when the IdP does not support asserting `acr`, `amr` and `auth_time`. The IdP baseline records these capabilities.

**Spec:** `.specs/01-authentication.md` (alignment with 04), `.specs/04-gxp-compliance.md`

**Blocked by:** None

**Status:** done

## In code today

`productionStartupProblems()` (`auth/src/authentication/session/startupGate.ts`) checks only idle timeout and production secrets. The baseline (`admin/idpBaselineRoutes.ts`) omits `auth_time`.

## Acceptance

- [x] Startup fails with a clear message if the IdP discovery metadata lacks `acr`, `amr` or `auth_time` support (production only; `session/idpAssuranceGate.ts`, called from `boot.ts`)
- [x] The baseline check requires `auth_time` (`authTimeAsserted`)
- [x] The drift report includes `auth_time`: critical drift when a baseline that asserted it loses it (`idpDriftDetection.ts`, from discovery `claims_supported`)
- [x] Unit tests cover an IdP missing each capability (a harness IdP integration test is not written)

## Notes

The gate reads `claims_supported` from discovery. Keycloak 26 may not advertise `amr` there, so verify against the shipped IdP before relying on it in a real deployment.

## Comments

2026-11-13: Checkmate audit — **holds** (acceptance green at `assertIdpAssurance` / `idpAssuranceProblems`; proving tests in `idpAssuranceGate.test.ts`).

**Deepen (auto-pick):** Collapse discovery fetch + required-claim check into deep `assessIdpAssurance(issuer, fetch)` (in-process). Non-array `claims_supported` treated as advertising nothing; `assertIdpAssurance` is a thin throw adapter. Did not touch `sessionIdleTimeoutProblems` / idle path.

**Files:** `auth/src/authentication/session/idpAssuranceGate.ts`, `idpAssuranceGate.test.ts`

**Tests:** `idpAssuranceGate.test.ts`

2026-11-13 Deep-API (integ): **holds**. Package exports `assertIdpAssurance` / `assessIdpAssurance`; integ with fake discovery plus boot-gate pattern (production-only).
- **Seams:** `assessIdpAssurance` (unit) → `assertIdpAssurance` / boot gate (package integ, fake discovery)
- **Integ:** `auth/src/authentication/session/idpAssuranceGate.integration.test.ts`
- **No commit/push** this pass.
