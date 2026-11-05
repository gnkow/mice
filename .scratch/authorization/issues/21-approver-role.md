# 21: Approver role

**What to build:** Add an `approver` role to the RBAC catalog. It is a namespace/repository role (not necessarily a manager) that the Owner can assign and remove, with every change audited. Signing a merge into a validated branch requires this role; `maintain` no longer implies it. One approver is enough: there is no minimum-approver, onboarding, offboarding or escalation rule.

**Spec:** `.specs/02-authorization.md` (alignment with 04), `.specs/04-gxp-compliance.md`

**Blocked by:** None

**Status:** done

## In code today

`approver` is absent from `auth/src/authzContract.ts` and `auth/src/rbacCatalog.ts`. Merge still requires `maintain` (`authzPathMap.ts`, `customRoles.ts`).

## Acceptance

- [x] `approver` exists in the role catalog (`APPROVER_ROLE` in `authzContract.ts`, an orthogonal grant, not a rank), assignable at namespace and repository scope by an Owner only. Users only for now; group approvers are not supported
- [x] Assignment and removal write audit events (`approver.grant`, `approver.revoke`)
- [x] Authorization exposes an "approver for this repository" decision the signing ceremony (gxp-compliance 01) can call (`decideIsApprover`)
- [x] `maintain` alone cannot sign; no code path requires two mergers or approvers (the signing check itself lands in gxp-compliance 01)
- [x] Bootstrap and admin grants never confer `approver` implicitly
- [x] `docs/authorization-routes.md` lists the new decision and routes (the path map covers only `/api` proxy routes, so it is unchanged)
