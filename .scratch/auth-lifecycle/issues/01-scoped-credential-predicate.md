# 01: Scoped-credential predicate (prefactor)

**What to build:** One rule on the Principal that answers "is this a scoped credential" replaces the scattered checks that cap authorization and refuse scoped PATs on per-user routes (notifications, favorites, and similar). Behaviour does not change; the existing tests are the safety net. Do this first so later tickets use a single rule.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Every place that treats a PAT with scopes specially uses the single rule
- [x] Scoped PATs still never get the instance-admin bypass or fine-grained grants
- [x] Scoped PATs are still refused on per-user routes (notifications, favorites, others found)
- [x] Existing auth unit and e2e tests pass unchanged
- [x] A test through the HTTP wiring seam pins the refusal behaviour before the refactor
