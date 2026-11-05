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
