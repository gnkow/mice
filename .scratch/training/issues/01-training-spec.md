# 01: Training spec

**What to build:** A new specification file `.specs/17-training.md` that maps each authorization permission and capability to required training modules. Defines who can mark training complete (instance admins only, no self-attestation). Documents the training verification process and future LMS integration approach. For now, assumes all users are trained (boolean flag), with granular per-permission tracking deferred to v2.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Create `.specs/17-training.md` with problem statement, user stories, implementation decisions, testing decisions and out of scope
- [ ] Map each instance permission to a required training module
- [ ] Map each namespace capability to a required training module
- [ ] Repository roles inherit training requirements (admin requires all trainings)
- [ ] Only instance admins can mark training complete (no self-attestation)
- [ ] Current state: all-or-nothing boolean (`trainingCompleted` / existing hooks); granular tracking and LMS webhook deferred
- [ ] Cross-link from `.specs/02-authorization.md`, `.specs/15-administration.md` and `.specs/04-gxp-compliance.md`
- [ ] Document: "For now, assume all users trained. Future: enforce per-permission training requirements."
