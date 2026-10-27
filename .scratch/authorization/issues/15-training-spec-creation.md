# 15: Training Spec Creation

**What to build:** A new specification file (e.g., `03-training.md` or similar) that maps each authorization permission and capability to required training modules. Defines who can mark training complete (instance admins only, no self-attestation). Documents the training verification process and future LMS integration approach. For now, assumes all users are trained (boolean flag), with granular per-permission tracking deferred to v2.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Create new spec file `.specs/03-training.md` (or appropriate number)
- [ ] Problem statement: Users must complete training before using sensitive permissions
- [ ] User stories: training-gated access, admin-marked completion, LMS integration
- [ ] Implementation decisions:
  - [ ] Map each instance permission to required training module
  - [ ] Map each namespace capability to required training module
  - [ ] Repository roles inherit training requirements (admin requires all trainings)
- [ ] Training completion: only instance admins can mark complete (no self-attestation)
- [ ] Current state: `trainingCompleted` boolean (all or nothing)
- [ ] Future: granular per-permission tracking, LMS webhook integration
- [ ] Testing decisions: verify training-gated permissions, admin-only completion
- [ ] Out of scope: self-attestation, LMS integration (v1)
- [ ] Document in spec: "For now, assume all users trained. Future: enforce per-permission training requirements."
