# 02: Merge requests

**What to build:** Merge requests are the only way into a validated branch. The UI and the CLI can open one; the CLI cannot sign and hands the user a browser step-up link. Opening a request marks its commits QC Marked. A request goes stale when the source or target moves; the author re-syncs and approval starts over, with no automatic rebase.

**Spec:** `.specs/05-repositories.md`, `.specs/07-cli.md` (alignment with 04), `.specs/04-gxp-compliance.md`

**Blocked by:** repositories/01

**Status:** ready-for-agent

## Acceptance

- [ ] Open, list, view and close a merge request from the web UI
- [ ] `oxen`/CLI can open a merge request and prints a browser link for signing
- [ ] A request stays unapproved until an eligible approver signs; there are no deadlines or escalation
- [ ] Opening a request sets its commits to QC Marked (see repositories/03)
- [ ] A merge request whose source head or target head moved is stale and cannot be signed
- [ ] The signature ceremony (gxp-compliance 05) is the only way to complete the merge
- [ ] An approver who authored any commit in the range cannot sign (enforced here, using the existing `selfMerge.ts` author comparison)
