# 22: Name Change History (U11)

**What to build:** Track name changes per Principal in a history table. Signatures display both the current name and the name-at-signing. Auditors can view the complete name timeline for a Principal.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

## Acceptance Criteria

- [ ] Database: principal_name_history table (id, principal_id, name, valid_from, valid_to, updated_at)
- [ ] On login: if IdP-provided name differs from current Principal.name, insert history row (close previous row's valid_to, open new row)
- [ ] Signature records include name snapshot at signing time (already implemented per T8, verify it works)
- [ ] Signature UI displays: "Signed by: Dr. Jane Smith (2021-03-15)" with optional "(currently: Dr. Jane Jones)" when name changed
- [ ] Admin UI: Principal detail page shows name history timeline (name, valid_from, valid_to)
- [ ] Tests for name change detection on login, history insertion, signature display with current name, admin UI timeline

## Context

Round 8 decision U11 addresses Q40/T8. A person's legal name changes (marriage, legal name change). The signature captured "Dr. Jane Smith" but later the IdP returns "Dr. Jane Jones" for the same iss|sub. Without a visible link, auditors reviewing 5-year-old signatures see two apparently different people.

Name history ensures auditors can see the complete identity timeline and understand that "Dr. Jane Smith (2021)" and "Dr. Jane Jones (2026)" are the same person.
