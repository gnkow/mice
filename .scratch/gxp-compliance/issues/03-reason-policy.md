# 03: Reason policy on mutation classes

**What to build:** Required reasons (minimum length, pick-list category, free text) on the defined mutation classes. New data (new files, commits on non-validated branches) needs none.

**Blocked by:** None (can start immediately)

**Status:** done

## Notes

- Reasons are required only when **updating or deleting** existing information (and for privileged settings / destructive / revocation). Creating new resources never requires a reason.
- Wire format: `X-Mice-Reason` (free text) + `X-Mice-Reason-Category` (pick-list).
- Proxied `file.write` is treated as create-exempt until validated-branch overwrite detection lands with repositories tickets; deletes and other update-class actions still require category + text.
- Change-control ids remain ticket 04.

## Acceptance

- [x] Reason required for: changes or deletions of existing records (update/delete classes), destructive actions, privileged settings, revocation
- [x] Reason shape is minimum length + pick-list category + free text
- [x] New data creation is accepted without a reason
- [x] Reason (and category) are stored on the audit event
- [x] HTTP tests: a mutation in each class is refused without them and accepted with them

## Comments

- **Audit:** holds at `mutationNeedsReason` / `resolveReason` + proxy/guarded HTTP.
- **Deepen (auto-pick Top):** extract `requireReasonCategory` + export `createExemptActions` / `isReasonCategory`.
- **Tests:** `auditReasonPolicy.test.ts` category seam + create-exempt list; existing proxy HTTP remains.
- **Seams:** module `requireReasonCategory`; `mutationNeedsReason` / `createExemptActions`.
