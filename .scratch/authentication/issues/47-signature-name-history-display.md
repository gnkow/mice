Status: ready-for-agent

# 47: Show name history on signatures

**Spec:** `.specs/01-authentication.md` (U11)

**Blocked by:** none

Split from issue 22. The history table and the name stored at signing time already exist.

## What to build

A signature displays the name captured at signing and the date: `Signed by: Dr. Jane Smith (2021-03-15)`. When the current name differs, the same view can show `currently: Dr. Jane Jones`. An admin or auditor can open the full timeline for a Principal: each name with valid-from and valid-to.

## In code today

`getNameHistory`, `getCurrentName`, and `getNameAtTime` read `principal_name_history`. The signature record stores `session.name`. No page renders the timeline or the "currently" line.

## Acceptance

- [ ] The signature view shows the name at signing and the signing date
- [ ] When the current name differs, the view can show that current name
- [ ] The Principal detail page lists the history in chronological order
- [ ] The view reads the stored history and does not ask the IdP
