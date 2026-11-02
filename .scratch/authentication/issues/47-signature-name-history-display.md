Status: done

# 47: Show name history on signatures

**Spec:** `.specs/01-authentication.md` (U11)

**Blocked by:** none

Split from issue 22. The history table and the name stored at signing time already exist.

## What to build

A signature displays the name captured at signing and the date: `Signed by: Dr. Jane Smith (2021-03-15)`. When the current name differs, the same view can show `currently: Dr. Jane Jones`. An admin or auditor can open the full timeline for a Principal: each name with valid-from and valid-to.

## In code today

`shownSignature` renders `Signed by: Dr. Jane Smith (2021-03-15)` from the name stored on the signature. When the stored current name differs, it adds `(currently: Dr. Jane Jones)`. The access-review report uses that line and links to the Principal page. `GET /auth/admin/principals/names` lists `principal_name_history` oldest first, with valid-from and valid-to, and does not ask the IdP. Settings links each instance admin to that page.

## Acceptance

- [x] The signature view shows the name at signing and the signing date
- [x] When the current name differs, the view can show that current name
- [x] The Principal detail page lists the history in chronological order
- [x] The view reads the stored history and does not ask the IdP
