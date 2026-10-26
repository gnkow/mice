# 09: Signing ceremony

**What to build:** A user can electronically sign or approve one or more records with a Part 11 compliant ceremony. Fresh authentication is required per signing action. Signing refuses without MFA evidence. The exact record is displayed with its hash bound to the signature, and the meaning (Authored / Reviewed / Approved) and full name are shown.

**Blocked by:** 04 (live IdP check and access states), 05 (authentication event audit and failure alerts)

**Status:** ready-for-agent

- [ ] Fresh authentication within 60 s of signing; the step-up window is never reused
- [ ] A record changed after display invalidates the signature
- [ ] Each signature record stores IdP authentication evidence (auth time, method and strength claims, IdP session id, token id), meaning, server time and record hash
- [ ] One-time e-signature declaration is recorded
- [ ] Bulk approval is one ceremony with one signature record per item, cap 50, shared ceremony id
- [ ] Nobody can sign or approve their own submission or Job; refusals are audited; no admin override
- [ ] Timestamps come only from the server clock
