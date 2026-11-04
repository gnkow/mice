Status: needs-triage

# 18: Auditor signature evidence e2e with a real signing ceremony

**Follow-up to:** `13-auditor-access.md`

## What to build

`e2e/tests/auditor-signature-evidence.spec.ts` (TC-AUDITOR-01) injects a `signature.created` event into the real `/auth/audit` response, because the signing step-up needs a live IdP. The rendering and the Auditor MFA gate run for real, but the stored evidence format is not exercised end to end.

Drive a real signing ceremony through Keycloak (step-up with MFA) in the e2e stack, then open the evidence as an Auditor, so a change to the stored evidence shape (`auth_time`, `jwks_key_id`, `token_verified_at`, `idp_issuer`) fails the test.

## Acceptance

- [ ] The e2e stack has a Keycloak user that completes MFA step-up
- [ ] The spec signs a document, then opens the evidence as an Auditor with no response injection
- [ ] The injected-event version of TC-AUDITOR-01 is removed
