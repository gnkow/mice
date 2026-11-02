Status: done

# 01: Test IdP harness and clock control

**Spec:** `.specs/01-authentication.md` (Q68)

## Outcome

Authentication tests run against an in-process fake IdP. The harness issues tokens for configurable users, including an external guest, a missing name claim, and MFA and non-MFA methods. Tests can move the BFF clock and the IdP clock. A table-driven suite format is documented, with a passing example.

## Acceptance

- [x] The fake IdP issues tokens for configurable users, including guest, missing name, MFA, and non-MFA
- [x] Tests can apply a clock offset to the BFF and the IdP
- [x] The suite format is documented with one passing example

## Code

- `auth/src/authentication/testing/fakeIdp.ts`
- `auth/src/authentication/testing/idpAdapter.ts`
- `auth/src/authentication/testing/README.md`
