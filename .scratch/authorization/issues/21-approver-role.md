# 21: Approver role

**What to build:** Add an `approver` role to the RBAC catalog. It is a namespace/repository role (not necessarily a manager) that the Owner can assign and remove, with every change audited. Signing a merge into a validated branch requires this role; `maintain` no longer implies it. One approver is enough: there is no minimum-approver, onboarding, offboarding or escalation rule.

**Spec:** `.specs/02-authorization.md` (alignment with 04), `.specs/04-gxp-compliance.md`

**Blocked by:** None

**Status:** ready-for-agent

## In code today

`approver` is absent from `auth/src/authzContract.ts` and `auth/src/rbacCatalog.ts`. Merge still requires `maintain` (`authzPathMap.ts`, `customRoles.ts`).

## Acceptance

- [ ] `approver` exists in the role catalog, assignable at namespace and repository scope by an Owner only
- [ ] Assignment and removal write audit events
- [ ] Authorization exposes an "approver for this repository" decision the signing ceremony (gxp-compliance 01) can call
- [ ] `maintain` alone cannot sign; no code path requires two mergers or approvers
- [ ] Bootstrap and admin grants never confer `approver` implicitly
- [ ] `docs/authorization-routes.md` and the path map list the new decision
