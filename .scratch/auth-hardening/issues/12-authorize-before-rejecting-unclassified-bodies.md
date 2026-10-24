# 12: Authorize before rejecting unclassifiable bodies

**What to build:** A request's authorization is evaluated before its body is rejected as unclassifiable, so an unauthorized Principal gets `403` rather than `400` and cannot write `request.rejected` audit rows. Rejection audit events carry namespace and repo.

**Blocked by:** 01 (author injection fails closed; done)

**Status:** ready-for-agent

- [x] Unauthorized Principal sending a malformed body gets `403` and no `request.rejected` row
- [x] Authorized Principal sending a malformed body gets `400` and one audited row with namespace and repo
- [x] Ordering is covered by a test at the proxy seam
- [x] Authz that depends on the body (repo create, `workspace_id`) still works
