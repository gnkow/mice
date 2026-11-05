# 07: Start gates: backup/restore and release manifest

**What to build:** The instance refuses to start unless a backup target is configured and reachable. A restore test must pass before the first regulated action (first validated-branch merge or signature). Each release carries a signed manifest (versions and digests of IdP configuration, search index, custom verifiers) verified at start; a mismatch is audited and shown in the admin overview. The traceability matrix (requirement id in test names) ships as a release artifact stored with the audit trail.

**Spec:** `.specs/04-gxp-compliance.md`, `.specs/16-operations.md` (alignment with 04)

**Blocked by:** None

**Status:** ready-for-agent

## Acceptance

- [ ] Start fails without a reachable backup target
- [ ] The first regulated action is refused until a restore test has passed
- [ ] Release manifest is signed, verified at start; mismatch is audited and visible in the admin overview
- [ ] Traceability matrix is generated from tagged tests and stored with the audit trail
- [ ] Effective regulated configuration is written to audit at each start or change
