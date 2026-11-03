# 07: Self-Merge Prevention

**What to build:** Merge operation blocked when the person performing the merge is the same as any commit author in the merge. Authorization enforces write role minimum (already done). Repositories module compares the merge signer's `iss|sub` to each commit's `author`. That field is the canonical `iss|sub` written by `.scratch/authentication/issues/08-human-commit-author.md`. If any match, merge is denied with audit trail. This enforces the 4-eyes principle (independent review) required by GxP.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Merge endpoint extracts commit author(s) from commits in the merge
- [x] Compare merge signer `iss|sub` to each commit's author identity
- [x] If signer === any commit author, reject merge with error "Self-merge forbidden (4-eyes principle)"
- [x] Audit both approved and denied merge attempts (include signer, authors, reason)
- [x] Authorization continues to enforce `write` role minimum (already implemented)
- [x] Responsibility split documented: authorization = role check, repositories = author comparison
- [x] Tests verify user can merge other users' commits
- [x] Tests verify user cannot merge their own commits
- [x] Tests verify audit logs record denied self-merge attempts
- [x] Tests verify merge with multiple authors blocks if signer matches any author

## Notes

- Decision: `auth/src/selfMerge.ts` (`decideSelfMerge`)
- Gate: `auth/src/proxy.ts` on `action === 'merge'` (GET mergeable authors, then POST or 403)
- Authz role floor unchanged (`maintain` / fine `merge` via path map)
