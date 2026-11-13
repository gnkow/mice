Status: done

# 26: Signature evidence metadata

**Spec:** `.specs/01-authentication.md` (U19, S6)

An auditor screen for this evidence is `.scratch/authorization/issues/13-auditor-access.md`.

## Outcome

The signing ceremony extracts `acr`, `amr`, and `auth_time` from the step-up id_token, plus the JWKS key id, the verification timestamp, and the issuer. Those fields are stored on the signature record and in the audit detail for the signature. Signing still refuses when MFA evidence is absent (issue 14).

## Acceptance

- [x] The signature record includes `acr`, `amr`, and `auth_time` when MFA evidence is present
- [x] The signature record includes JWKS key id, verification time, and issuer
- [x] The same evidence is included in the signature audit detail

## Code

- `auth/src/authentication/signing/signingRoutes.ts`
- `auth/src/authentication/signing/signingCeremony.ts` (`assembleSignatureEvidence`)
- `auth/src/authentication/signing/signingEvidence.ts`
- `auth/src/authentication/oidc/tokenVerificationMetadata.ts`
- `auth/src/authentication/signing/mfaEvidence.ts`

## Comments

- **Audit:** holds — signature records and audit detail carry `acr`/`amr`/`auth_time` plus JWKS kid, verification time, and issuer when MFA evidence is present.
- **Deepen:** extracted `assembleSignatureEvidence` in `signingCeremony.ts` so signing verification and token-metadata extraction share one assembly seam; `signingRoutes` unchanged beyond existing `verifySigningEvidence` use.
- **Tests:** `signingEvidence.test.ts` (assemble + verify), `signatureEvidenceMetadata.test.ts`, `signingCeremony.test.ts`.

2026-11-13 — Deep-API deepen (auto-pick Top) + integ: **holds**. Added deep `buildSigningSessionInfo` so execute maps assembled evidence → `SessionInfo` behind one ceremony seam; routes stay a thin adapter over `verifySigningEvidence` + `buildSigningSessionInfo`. Unit: assemble + buildSigningSessionInfo. Integ: `POST /auth/sign/execute` persists evidence on the signature record and `esign.created` audit detail.

**Files:** `signingCeremony.ts` (`assembleSignatureEvidence`, `buildSigningSessionInfo`), `signingRoutes.ts` (adapter), `signingEvidence.test.ts`, `signingRoutes.integration.test.ts`

2026-11-13: /deep-ui skipped — no-ui (API/CLI/boot acceptance only). User acknowledged skip on authentication deep-ui board.
