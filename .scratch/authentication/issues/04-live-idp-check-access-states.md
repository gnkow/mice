# 04: Live IdP check and access states

**What to build:** Access always reflects the IdP. Every authenticated request performs a live IdP/directory check (ticket 19 supersedes the original 5-minute bound); if the check cannot run, access is denied with no cache. IdP status and Mice flags are independent. A Principal disabled in the IdP loses access at the next check; a short re-enable restores it automatically, while a long disable needs an admin. Mice flags suspend grants and need an explicit lift.

**Blocked by:** 02 (web login tracer)

**Status:** completed

- [x] IdP unreachable blocks login and every authenticated request (503, no cache)
- [x] IdP-disabled Principal loses access immediately at the next check
- [x] Re-enable restores access automatically if disabled 30 days or less and no Mice flag is set; longer needs admin re-confirmation; every restore is audited
- [x] Mice flags need an explicit lift; grants are kept (suspended), not deleted
- [x] Auto-provisioning and bootstrap rules grant read-only baseline at most (rules apply to everyone)
- [ ] Group matching uses object ids (deferred to authorization ticket 08)

## Deferred / superseded

- **5-minute bound:** superseded by ticket 19 and its U3 decision. The check runs on every authenticated request.
- **iss+sub reuse:** deferred to ticket 27 (`27-iss-sub-reuse-investigation.md`), which needs IdP/product input.
- **Group object ids:** owned by authorization ticket 08, where groups are modelled.
- **`AUTHZ_GROUP_BOOTSTRAP`:** removed. It could grant write/admin rights from IdP group names, conflicting with the read-only baseline rule.

## Comments

- Admin access-state actions (flag, lift, re-confirm restore) are exposed in Settings → Access state and audited.

- Implemented in `auth/src/authentication/access/accessState.ts` (decision, flags, restore), `accessStateRoutes.ts` (admin API), `requireAuth.ts` and `loginFlow.ts` (live check wiring), plus `web/src/components/AdminAccessStateSection.tsx`.
- Tests: `auth/src/authentication/access/accessState.test.ts`, `idpCheck.test.ts`, `loginFlowProvider.test.ts`, `requireAuth.test.ts`.
