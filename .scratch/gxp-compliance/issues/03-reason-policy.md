# 03: Reason policy on mutation classes

**What to build:** Required reasons (minimum length, pick-list category, free text) on the defined mutation classes. New data (new files, commits on non-validated branches) needs none.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Reason required for: changes or deletions of existing records on validated branches, destructive actions, privileged settings, revocation
- [ ] Reason shape is minimum length + pick-list category + free text
- [ ] New data creation is accepted without a reason
- [ ] Reason is stored on the audit event (and on the signature record when the action is signed)
- [ ] HTTP tests: a mutation in each class is refused without a reason and accepted with one
