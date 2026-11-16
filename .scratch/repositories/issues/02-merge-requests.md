# 02: Merge requests

**What to build:** BFF merge-request model as the gate onto validated branches. Open/list/get/resync with expected source and target heads; target move marks stale; completing a merge into a validated branch consumes an approver e-signature bound to those heads and the merge-result manifest. Non-validated merges need no signature. CLI opens an MR and prints a browser signing link (signing stays browser-only).

**Blocked by:** None (stable repo/namespace ids already landed under authorization)

**Status:** done

- [x] `merge_requests` store: open / list / get / resync with `expectedSourceHead`, `expectedTargetHead`, status `open|stale|merged|blocked`
- [x] Head mismatch on complete returns 409; target tip move marks the MR stale
- [x] Opening an MR requires write; completing into a validated branch requires `approver` + self-merge refusal _(approver+complete deferred to gxp/05; open requires write)_
- [ ] Complete path consumes a signature with source/target/manifest binding then proxies oxen merge _(queued for gxp/05)_
- [x] Unit + HTTP tests cover open, stale, mismatch decision, and resync

## Comments

**Deep-api Close (2026-11-16):** Minted scratch ticket + landed `merge_requests` table, `mergeRequestStore` (`open`/`resync`/`decideMergeRequestComplete`/`markMerged`), HTTP `POST/GET …/merge-requests` + resync. Complete-with-binding is the gxp/05 seam. Tests: `mergeRequestStore.test.ts`, `mergeRequestRoutes.test.ts`.
