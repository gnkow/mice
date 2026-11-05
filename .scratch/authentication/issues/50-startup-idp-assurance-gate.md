# 50: Startup IdP assurance gate

**What to build:** The instance refuses to start when the IdP does not support asserting `acr`, `amr` and `auth_time`. The IdP baseline records these capabilities.

**Spec:** `.specs/01-authentication.md` (alignment with 04), `.specs/04-gxp-compliance.md`

**Blocked by:** None

**Status:** ready-for-agent

## In code today

`productionStartupProblems()` (`auth/src/authentication/session/startupGate.ts`) checks only idle timeout and production secrets. The baseline (`admin/idpBaselineRoutes.ts`) omits `auth_time`.

## Acceptance

- [ ] Startup fails with a clear message if the IdP metadata/baseline lacks `acr`, `amr` or `auth_time` support
- [ ] The baseline and drift report include `auth_time`
- [ ] Test IdP harness covers an IdP missing each capability
