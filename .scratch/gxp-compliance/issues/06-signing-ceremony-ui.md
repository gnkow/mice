# 06: Signing ceremony UI

**What to build:** The merge-request UI walks an approver through the signing ceremony: shows the merge content hash, meaning "Approved" and printed name; collects reason and change-control id; completes step-up in the browser. The CLI can open a merge request but only prints a browser link for signing.

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] Merge-request page displays content hash, meaning and printed name before the signer confirms
- [ ] Content changed after display invalidates the pending signature
- [ ] UI collects required reason and change-control id
- [ ] Step-up completes in the browser; CLI only opens a merge request and prints a signing link
- [ ] Clear error states for refusal (not approver, author in range, stale heads, audit unavailable)
