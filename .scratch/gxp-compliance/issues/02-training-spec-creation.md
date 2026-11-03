Status: ready-for-agent

# 02: Training Spec Creation

**Spec:** `.specs/04-gxp-compliance.md` (and the deferred training section in `.specs/02-authorization.md`)

**Moved from:** `.scratch/authorization/issues/15-training-spec-creation.md`

**Blocked by:** None (can start immediately)

## What to build

A new specification file (e.g. `.specs/03-training.md` or a Training section folded into `.specs/04-gxp-compliance.md`) that maps each authorization permission and capability to required training modules. Defines who can mark training complete (instance admins only, no self-attestation). Documents the training verification process and future LMS integration approach. For now, assumes all users are trained (boolean flag), with granular per-permission tracking deferred to v2.

Part 11 11.10(i) and Annex 11 expect persons who use the system to have education, training and experience for their tasks; admin Q12 in `.specs/15-administration.md` records training as currently out of scope pending this spec.

## Acceptance

- [ ] Create or extend the training spec (prefer `.specs/03-training.md`, or a dedicated section of `.specs/04-gxp-compliance.md` if that fits better)
- [ ] Problem statement: Users must complete training before using sensitive permissions
- [ ] User stories: training-gated access, admin-marked completion, LMS integration
- [ ] Implementation decisions:
  - [ ] Map each instance permission to required training module
  - [ ] Map each namespace capability to required training module
  - [ ] Repository roles inherit training requirements (admin requires all trainings)
- [ ] Training completion: only instance admins can mark complete (no self-attestation)
- [ ] Current state: `trainingCompleted` boolean (all or nothing; `instanceTraining` / `hasCompletedTraining` already exist)
- [ ] Future: granular per-permission tracking, LMS webhook integration
- [ ] Testing decisions: verify training-gated permissions, admin-only completion
- [ ] Out of scope: self-attestation, LMS integration (v1)
- [ ] Document in spec: "For now, assume all users trained. Future: enforce per-permission training requirements."
- [ ] Cross-link from `.specs/02-authorization.md` (Training deferred) and `.specs/04-gxp-compliance.md`
