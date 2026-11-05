# 01: Validated branches

**What to build:** A branch can be validated. The default branch of every repository is validated from creation and starts empty. Nobody (including Owners and instance admins) can commit to, force-push to, or delete a validated branch directly; content arrives only through a signed merge. Other branches opt in. Marking or unmarking a branch as validated is a signed, reasoned action.

**Spec:** `.specs/05-repositories.md` (alignment with 04), `.specs/04-gxp-compliance.md`

**Blocked by:** authorization/21 (approver role)

**Status:** ready-for-agent

## Acceptance

- [ ] New repositories get an empty default branch that is validated
- [ ] Direct commit, push, force-push, delete and rewrite of a validated branch are refused for every role, with an audited refusal
- [ ] Non-validated branches keep today's behaviour
- [ ] Other branches can be marked validated by an Owner with step-up, a reason and a change-control id, audited (the signed unmark is repositories/04)
- [ ] Templates enter a new repository through a merge request into the empty default branch (no unsigned seed)
- [ ] Small-file direct commit and upload completion (data transfer) cannot land on a validated branch; they land on a non-validated branch
- [ ] HTTP tests cover each refused operation
