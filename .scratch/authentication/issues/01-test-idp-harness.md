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
- `auth/src/authentication/testing/fakeIdpAdapter.ts`
- `auth/src/authentication/testing/authTestApp.ts`
- `auth/src/authentication/testing/authTestApp.test.ts`
- `auth/src/authentication/testing/idpAdapter.contract.test.ts`
- `auth/src/authentication/testing/README.md`

## Comments

- **Audit:** holds — fake IdP + clock + table-driven example proven by `authTestApp.test.ts`; guest / missing name / MFA / non-MFA proven by `idpAdapter.contract.test.ts` through the `IdpAdapter` seam.
- **Deepen:** Collapsed the leaky `issueAuthCode` helper into a deeper `AuthTestApp.signIn(sub)` interface. Login code/state/PKCE choreography stays behind the module seam; callers get a session cookie (and replay handles) without learning the callback protocol. `issueAuthCode` is now an internal adapter detail of the harness implementation.
- **Files:** `authTestApp.ts`, `authTestApp.test.ts`, `README.md`.
