# 04: Signed unmark of a validated branch

**What to build:** Removing the validated flag from a branch is a signed, reasoned action, so it cannot be used as a side door around merge approval. It uses the same signing ceremony as a merge.

**Spec:** `.specs/05-repositories.md`, `.specs/04-gxp-compliance.md`

**Blocked by:** repositories/01, gxp-compliance/05

**Status:** ready-for-agent

## Acceptance

- [ ] Unmarking requires an approver signature with step-up, a reason and a change-control id
- [ ] The default branch can be unmarked only through this signed action, and the action is audited
- [ ] Without a signature the unmark is refused, audited
