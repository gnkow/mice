# 21: Approver role

**What to build:** Add an `approver` role to the RBAC catalog. It is a namespace/repository role (not necessarily a manager) that the Owner can assign and remove, with every change audited. Signing a merge into a validated branch requires this role; `maintain` no longer implies it. One approver is enough: there is no minimum-approver, onboarding, offboarding or escalation rule.

**Spec:** `.specs/02-authorization.md` (alignment with 04), `.specs/04-gxp-compliance.md`

**Blocked by:** None

**Status:** done

## Acceptance

- [x] `approver` exists in the role catalog (`APPROVER_ROLE` in `authzContract.ts`, an orthogonal grant, not a rank), assignable at namespace and repository scope by an Owner only. Users only for now; group approvers are not supported
- [x] Assignment and removal write audit events (`approver.grant`, `approver.revoke`)
- [x] Authorization exposes an "approver for this repository" decision the signing ceremony (gxp-compliance 05) can call (`decideIsApprover`)
- [x] `maintain` alone cannot sign; no code path requires two mergers or approvers (the signing check itself lands in gxp-compliance 05)
- [x] Bootstrap and admin grants never confer `approver` implicitly
- [x] `docs/authorization-routes.md` lists the new decision and routes (the path map covers only `/api` proxy routes, so it is unchanged)

## Code

- `auth/src/authzContract.ts` (`APPROVER_ROLE`)
- `auth/src/authzApproverStore.ts` (grant / revoke / list / `isApprover` / `decideIsApprover`)
- `auth/src/authz.ts` (re-exports `decideIsApprover`; `decideManageApprovers`)
- `auth/src/namespaceRoutes.ts` (approver HTTP routes)
- Tests: `authzApproverStore.test.ts`, `approvers.test.ts`

## Comments

**Deep-api Deepen (2026-11-13):** Holds — approver catalog, Owner-only assign/revoke, audit events, and `decideIsApprover` already shipped. Auto-picked Top: co-locate `decideIsApprover` in `authzApproverStore` (grant/decision locality); `authz.ts` re-exports. Unit: `authzApproverStore.test.ts`. Integration: `approvers.test.ts` (HTTP Owner gate + audit). Removed stale “In code today” blurb claiming approver absent.


**Deep-ui (2026-11-13):** Skipped as **no-ui** with user acknowledgment on implement. Acceptance has no UI surface to deepen under `/deep-ui`.
