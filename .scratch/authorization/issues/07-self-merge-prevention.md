# 07: Self-Merge Prevention

**What to build:** Merge operation blocked when the person performing the merge is the same as any commit author in the merge. Authorization enforces write role minimum (already done). Repositories module compares merge signer identity to commit author(s) extracted from the commits being merged. If any match, merge is denied with audit trail. This enforces the 4-eyes principle (independent review) required by GxP.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Merge endpoint extracts commit author(s) from commits in the merge
- [ ] Compare merge signer `iss|sub` to each commit's author identity
- [ ] If signer === any commit author, reject merge with error "Self-merge forbidden (4-eyes principle)"
- [ ] Audit both approved and denied merge attempts (include signer, authors, reason)
- [ ] Authorization continues to enforce `write` role minimum (already implemented)
- [ ] Responsibility split documented: authorization = role check, repositories = author comparison
- [ ] Tests verify user can merge other users' commits
- [ ] Tests verify user cannot merge their own commits
- [ ] Tests verify audit logs record denied self-merge attempts
- [ ] Tests verify merge with multiple authors blocks if signer matches any author
