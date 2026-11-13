# 12: Path Classification Documentation

**What to build:** The route classification table is committed and maintained. `docs/authorization-routes.md` documents all classified routes with their minimum roles/permissions. ADR 0002 updated to state "deny all unclassified routes" explicitly. The route table in `authzPathMap.ts` is the source of truth and is referenced from the spec. Developers can look up any route's classification requirements.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Commit `docs/authorization-routes.md` (committed)
- [x] Update ADR 0002 (`docs/adr/0002-bff-default-deny.md`) to state "deny all unclassified routes"
- [x] Add comment in `authzPathMap.ts` pointing to documentation file
- [x] Spec appendix references `docs/authorization-routes.md` for complete table
- [x] Route table includes all current oxen routes with minimum role/permission (needs a contract test against a pinned oxen-server route list, which does not exist yet; the docs list every classified route)
- [x] Documentation shows route classification maintenance process
- [x] Tests verify documentation matches the enforced tables (`authzRoutesDocs.test.ts`; found and fixed the `merge` role listed as write instead of maintain)
- [x] Tests verify unclassified routes are denied (`authzRoutesDocs.test.ts`, plus the existing default-deny tests in `authz.test.ts`)

## Comments

**Deep-api Close (2026-11-13):** Added `auth/src/fixtures/oxen-server-routes.pinned.json` (compose image `oxen/oxen-server:latest` + Mice web mutators) and contract coverage in `authzRoutesDocs.test.ts`. Classified `PATCH …/rename` and `…/transfer` as `repo.metadata` (admin). Docs Testing/Maintenance updated.


**Deep-ui (2026-11-13):** Skipped as **no-ui** with user acknowledgment on implement. Acceptance has no UI surface to deepen under `/deep-ui`.
