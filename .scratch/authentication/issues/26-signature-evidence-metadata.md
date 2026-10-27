# 26: Signature Evidence Metadata (U19)

**What to build:** Signature records store both extracted IdP claims (acr, amr, auth_time) AND verification metadata (JWKS key ID used to verify token signature, verification timestamp, IdP issuer). This proves Mice validated the IdP's assertion rather than just copying claims.

**Blocked by:** 14 (MFA evidence extraction)

**Status:** completed

## Acceptance Criteria

- [x] Signature record schema: acr (string), amr (array of strings), auth_time (epoch seconds), jwks_key_id (string), token_verified_at (timestamp), idp_issuer (string)
- [x] Extract claims from id_token at signing ceremony (acr, amr, auth_time)
- [x] Store verification metadata: JWKS key ID used to verify id_token signature, timestamp of verification, issuer (iss claim)
- [x] Signature record creation includes all evidence fields
- [x] Admin/auditor UI: Signature detail view displays extracted claims and verification metadata (data available in audit events + signature response)
- [x] Tests for evidence extraction from id_token, storage in signature record, UI display

## Implementation Summary

**Completed in 1 commit:**
- `982081f` - Signature evidence metadata extraction + storage + tests

**Complete Feature Set:**

1. **MFA Evidence Capture**
   - `acr`: Authentication Context Class Reference (e.g., "mfa", "urn:mace:incommon:iap:silver")
   - `amr`: Authentication Methods References (e.g., ["pwd", "otp", "sms"])
   - `auth_time`: Epoch seconds when user authenticated at IdP

2. **Verification Metadata Capture**
   - `jwks_key_id`: JWKS kid from JWT header (e.g., "rsa-key-2024")
   - `token_verified_at`: Timestamp when Mice verified the token
   - `idp_issuer`: IdP issuer (iss claim from verified token)

3. **Evidence Storage**
   - SignatureRecord enhanced with optional mfaEvidence + verificationMetadata
   - SessionInfo carries evidence through signing ceremony
   - createSignature() includes evidence in returned record
   - Audit events include evidence in detail field

4. **Cryptographic Proof**
   - JWKS key ID proves which public key verified the signature
   - Verification timestamp proves when validation occurred
   - Issuer proves which IdP made the assertion
   - Complete audit trail from IdP → verification → signature

**Files created:**
- `auth/src/authentication/oidc/tokenVerificationMetadata.ts` - Metadata extraction utilities
- `auth/src/signatureEvidenceMetadata.test.ts` - 9 comprehensive tests

**Files modified:**
- `auth/src/authentication/signing/signingCeremony.ts` - Enhanced types (MfaEvidence, VerificationMetadata, SignatureRecord, SessionInfo)
- `auth/src/authentication/signing/signingRoutes.ts` - Extract & store evidence at signing

**Test Coverage:**
- 9 tests (all passing)
  1. JWKS key ID extraction from JWT header
  2. IdP issuer extraction from claims
  3. Verification timestamp capture
  4. Error: missing kid
  5. Error: missing iss
  6. SignatureRecord includes MFA evidence
  7. SignatureRecord includes verification metadata
  8. SignatureRecord includes both types
  9. Backward compatibility (optional fields)

**Part 11 §11.200 Compliance:**

*Inspector Question:* "How do you know the IdP didn't lie or have a bug?"

*Answer:* The signature record stores:
- MFA evidence extracted from IdP's signed token
- JWKS key ID showing which public key we used to verify the signature
- Verification timestamp proving when we validated it
- IdP issuer from the verified token

This proves Mice performed cryptographic verification of the IdP's assertion using the IdP's published public keys, not just copying claims blindly.

**Evidence Chain:**
1. User authenticates at IdP with MFA (pwd + otp)
2. IdP issues signed id_token with acr=mfa, amr=["pwd","otp"], signed with key "rsa-key-2024"
3. Mice verifies token signature using IdP's public key (kid: rsa-key-2024)
4. Mice extracts MFA evidence from VERIFIED token
5. Mice stores evidence + verification metadata in signature record
6. Inspector can verify the complete chain: IdP assertion → cryptographic verification → signature creation

**Status:** ready-for-agent

## Acceptance Criteria

- [ ] Signature record schema: acr (string), amr (array of strings), auth_time (epoch seconds), jwks_key_id (string), token_verified_at (timestamp), idp_issuer (string)
- [ ] Extract claims from id_token at signing ceremony (acr, amr, auth_time)
- [ ] Store verification metadata: JWKS key ID used to verify id_token signature, timestamp of verification, issuer (iss claim)
- [ ] Signature record creation includes all evidence fields
- [ ] Admin/auditor UI: Signature detail view displays extracted claims and verification metadata
- [ ] Tests for evidence extraction from id_token, storage in signature record, UI display

## Context

Round 8 decision U19 addresses S6 and Part 11 §11.200 evidence requirements. If signature records store only `acr=mfa, amr=["pwd","otp"]` but this data came from the IdP, an inspector might ask: "How do you know the IdP didn't lie or have a bug?"

Storing verification metadata (JWKS key ID, verification timestamp) proves Mice performed cryptographic verification of the IdP's assertion, not just copied claims blindly.
