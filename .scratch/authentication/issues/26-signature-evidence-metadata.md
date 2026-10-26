# 26: Signature Evidence Metadata (U19)

**What to build:** Signature records store both extracted IdP claims (acr, amr, auth_time) AND verification metadata (JWKS key ID used to verify token signature, verification timestamp, IdP issuer). This proves Mice validated the IdP's assertion rather than just copying claims.

**Blocked by:** 14 (MFA evidence extraction)

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
