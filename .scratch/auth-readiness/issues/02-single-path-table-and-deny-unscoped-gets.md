# 02: Single path table and deny unscoped GETs

**What to build:** One classified route table drives every proxied authorization decision. GET/HEAD paths that are not recognised are denied unless on an explicit allowlist (version, health, oxen version, namespace list and detail). A test fails when a reachable route is unclassified.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Decisions derive from the table; the documented table and the enforced one cannot diverge
- [x] Unrecognised GET/HEAD returns 403 and oxen is not called
- [x] Allowlisted public and namespace routes still work
- [x] Unknown mutating routes remain admin-only
- [x] Table-completeness test fails on an unclassified route
- [x] Existing TC-AUTHO tests pass
