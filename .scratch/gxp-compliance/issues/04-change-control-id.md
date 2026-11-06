# 04: Change-control id pattern

**What to build:** A configurable per-namespace change-control id pattern, required on the reason-policy mutation classes and on merge signatures. The id is validated against the pattern and stored on the audit event and signature record.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Each namespace has a configurable change-control id pattern
- [ ] Change-control id required for: validated-branch changes/deletes, destructive actions, privileged settings, revocation, and merge signatures
- [ ] Invalid or missing ids are refused before the mutation runs
- [ ] Valid ids are stored on the audit event and the signature record
- [ ] New data creation is accepted without a change-control id
- [ ] HTTP tests cover refuse and accept paths for each required class
