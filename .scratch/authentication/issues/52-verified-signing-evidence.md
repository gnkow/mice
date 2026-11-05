# 52: Verified, complete signing evidence

**What to build:** Signing refuses unless the step-up produced a freshly verified ID token with `auth_time` within the allowed age and `acr`/`amr` asserting a qualifying method. Missing or stale claims refuse the signature; they never default.

**Spec:** `.specs/01-authentication.md`, `.specs/04-gxp-compliance.md`

**Blocked by:** 50

**Status:** ready-for-agent

## In code today

Signing decodes the stored token and treats MFA heuristically; a missing `auth_time` becomes `0`, and `extractMfaEvidence()` allows a missing `auth_time` (`signing/signingRoutes.ts`, `signing/mfaEvidence.ts`).

## Acceptance

- [ ] The token is re-verified (JWKS, `iss`, `aud`, `auth_time` age) at signing time
- [ ] Missing `auth_time`, `acr` or `amr` refuses the signature, audited
- [ ] Evidence stored: `auth_time`, `acr`, `amr`, key id, verification time, issuer, IdP session and token ids
- [ ] Tests with the harness IdP for stale, missing and weak claims
