# 09: Route allowlist for author-free writes

**What to build:** Replace the content-type allowlist from ticket 01 with an explicit allowlist of author-free write routes (binary chunk/version uploads and hash queries). A write on any route not on the allowlist and not author-bearing is unproxyable, even if the client labels the body `application/octet-stream` or `application/gzip`. This closes the gap between ADR 0001 ("explicit allowlist of author-free writes") and the current content-type check.

**Blocked by:** 01 (author injection fails closed; done)

**Status:** ready-for-agent

- [x] Inventory oxen write routes and classify each as author-bearing or author-free
- [x] Octet-stream/gzip body on a non-allowlisted route returns `400` and sends nothing upstream
- [x] Allowlisted routes still proxy unchanged (uploads, `/versions` query)
- [x] Unknown new write routes are rejected until classified
- [x] Rejection audited with namespace and repo where known
