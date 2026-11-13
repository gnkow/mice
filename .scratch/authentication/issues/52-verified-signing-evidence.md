# 52: Verified, complete signing evidence

**What to build:** Signing refuses unless the step-up produced a freshly verified ID token with `auth_time` within the allowed age and `acr`/`amr` asserting a qualifying method. Missing or stale claims refuse the signature; they never default.

**Spec:** `.specs/01-authentication.md`, `.specs/04-gxp-compliance.md`

**Blocked by:** 50

**Status:** done

## In code today

Signing decodes the stored token and treats MFA heuristically; a missing `auth_time` becomes `0`, and `extractMfaEvidence()` allows a missing `auth_time` (`signing/signingRoutes.ts`, `signing/mfaEvidence.ts`).

## Acceptance

- [x] The token is re-verified (JWKS, `iss`, `aud`, `auth_time` age) at signing time
- [x] Missing `auth_time`, `acr` or `amr` refuses the signature, audited
- [x] Evidence stored: `auth_time`, `acr`, `amr`, key id, verification time, issuer, IdP session and token ids
- [x] Tests for stale, missing and weak claims (`signing/signingEvidence.test.ts`, local signing key rather than the compose IdP)

## Comments

2026-11-13: Checkmate audit — **holds** (re-verify + refuse missing/stale/weak; full evidence stored; proving tests in `signingEvidence.test.ts`).

**Deepen (auto-pick):** Collapse claim completeness into deep `assessSigningEvidenceCompleteness(payload, age)` (in-process). `verifySigningEvidence` verifies JWT then completeness, then `assembleSignatureEvidence` only on ok — assembly stays storage-shaped; completeness owns refusal.

**Files:** `auth/src/authentication/signing/signingEvidence.ts`, `signingEvidence.test.ts` (`assembleSignatureEvidence` unchanged interface)

**Tests:** `signingEvidence.test.ts` (completeness + verify + assemble)

2026-11-13 Deep-API (integ): **holds**. Added execute-path refusals for incomplete evidence (missing `auth_time`/`acr`/`amr`, stale token claim) without undoing 09/20/26 cases.
- **Seams:** `assessSigningEvidenceCompleteness` / `verifySigningEvidence` (unit) → `POST /auth/sign/execute` (route integ)
- **Integ:** `auth/src/authentication/signing/signingRoutes.integration.test.ts` (Ticket 52 describe)
- **No commit/push** this pass.

2026-11-13: /deep-ui skipped — no-ui (API/CLI/boot acceptance only). User acknowledged skip on authentication deep-ui board.
