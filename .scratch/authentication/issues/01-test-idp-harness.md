# 01: Test IdP harness and clock control

**What to build:** A containerised test IdP, a controllable clock offset and a table-driven authentication test suite, so every later auth ticket can be verified end to end (spec Q68). Demo: the suite runs green against a fake login.

**Blocked by:** None (can start immediately)

**Status:** resolved-pending-merge

- [x] Test IdP (in-process fake; container adapter documented in auth/src/authentication/testing/README.md) issues tokens for configurable users (including external guest, missing name claim, MFA and non-MFA authentication methods)
- [x] Clock offset can be applied to the BFF and the IdP in tests
- [x] Table-driven suite format documented with one passing example
- [x] Spec: `respec/01-authentication/spec.md`
