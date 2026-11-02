Status: deferred

# 13: Authentication validation pack

**Spec:** `.specs/01-authentication.md` (T6, R6)

**Blocked by:** none

The running clock-drift alert is issue 45. The IdP outage incident is issue 46.

## What to build

Ship the authentication validation pack: a requirement-to-test traceability matrix that covers the authentication spec, a risk assessment, IQ and OQ evidence, and a revalidation trigger when the IdP baseline or authentication code changes. Record the IdP as a qualified supplier, including the change-notification agreement.

## In code today

`validation.ts` builds in-memory matrix, risk, IQ, OQ, and clock-drift objects from arguments the caller supplies. Nothing writes a pack, nothing watches authentication code or baseline changes, and no supplier agreement is in the repo.

## Acceptance

- [ ] Every authentication requirement in `.specs/01-authentication.md` maps to at least one automated test, and the matrix fails generation when a requirement has none
- [ ] The pack contains a risk assessment and IQ/OQ evidence for the authentication release
- [ ] An IdP-baseline change or an authentication-code change marks the pack as requiring revalidation
- [ ] The pack names the IdP as a qualified supplier and includes the change-notification agreement

## Comments

Owner deferred this on 2026-11-01. Leave it until it is set back to `ready-for-agent`. The running clock-drift alert stays issue 45. The IdP outage incident stays issue 46.
