# 05: Reason and change-control policy

**What to build:** Required reasons (minimum length, pick-list category, free text) and a change-control id (configurable per-namespace pattern) on the defined mutation classes. New data (new files, commits on non-validated branches) needs neither.

**Spec:** `.specs/04-gxp-compliance.md`

**Blocked by:** None

**Status:** ready-for-agent

## Acceptance

- [ ] Reason required for: changes or deletions of existing records on validated branches, destructive actions, privileged settings, revocation
- [ ] Change-control id required for those classes and for merge signatures; validated against the namespace pattern
- [ ] New data creation is accepted without either
- [ ] Both are stored on the audit event and the signature record
- [ ] HTTP tests: a mutation in each class is refused without them and accepted with them
