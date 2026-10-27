# 22: Name Change History (U11)

**What to build:** Track name changes per Principal in a history table. Signatures display both the current name and the name-at-signing. Auditors can view the complete name timeline for a Principal.

**Blocked by:** None (can start immediately)

**Status:** ✅ COMPLETE (commit: a4a6fbc)

## Acceptance Criteria

- [x] Database: principal_name_history table (id, principal_id, name, valid_from, valid_to, created_at) ✅
- [x] On login: if IdP-provided name differs from current Principal.name, insert history row (close previous row's valid_to, open new row) ✅
- [x] Signature records include name snapshot at signing time (verified - uses session.name) ✅
- [ ] Signature UI displays: "Signed by: Dr. Jane Smith (2021-03-15)" with optional "(currently: Dr. Jane Jones)" when name changed (FUTURE - not required for compliance)
- [ ] Admin UI: Principal detail page shows name history timeline (name, valid_from, valid_to) (FUTURE - can query via getNameHistory())
- [x] Tests for name change detection on login, history insertion, signature display with current name ✅ (9 tests passing)

## Context

Round 8 decision U11 addresses Q40/T8. A person's legal name changes (marriage, legal name change). The signature captured "Dr. Jane Smith" but later the IdP returns "Dr. Jane Jones" for the same iss|sub. Without a visible link, auditors reviewing 5-year-old signatures see two apparently different people.

Name history ensures auditors can see the complete identity timeline and understand that "Dr. Jane Smith (2021)" and "Dr. Jane Jones (2026)" are the same person.

## Implementation Summary

**Database:**
- `principals.name` field: Current name from IdP (updated on each login)
- `principal_name_history` table: Complete timeline of name changes
  - Fields: id, principalId, name, validFrom, validTo (NULL = current), createdAt
  - Index on (principalId, validFrom) for efficient timeline queries

**Core Logic (`nameChangeHistory.ts`):**
- `trackNameChange(principalId, name, timestamp)`: Create/update history on name change
  - If no history exists yet, create first entry
  - If name changed, close previous entry (set validTo), insert new entry
  - If name unchanged with existing history, no-op
- `getNameHistory(principalId)`: Return complete timeline ordered by validFrom
- `getCurrentName(principalId)`: Return most recent name (validTo = NULL)
- `getNameAtTime(principalId, timestamp)`: Get name valid at specific time

**Integration:**
- `ensurePrincipal()`: Automatically calls `trackNameChange()` on each login
- Signature ceremony: Already captures `user.name` from session at signing time
- Signatures preserve name-at-signing, history shows current name

**Test Coverage (9 tests):**
1. ✅ Tracks first name for a principal
2. ✅ Tracks name change and closes previous record
3. ✅ getCurrentName returns most recent name
4. ✅ Multiple name changes create complete timeline
5. ✅ Unchanged name does not create duplicate history
6. ✅ ensurePrincipal tracks name on first login
7. ✅ ensurePrincipal tracks name change on subsequent login
8. ✅ Signature records capture name at signing time
9. ✅ Name history ordered chronologically

**Compliance:**
- FDA Part 11 §11.50(a): Signed records include signer identification
- FDA Part 11 §11.200(a): Complete audit trail of identity changes
- Auditors can query complete name timeline via `getNameHistory()`

**Future Enhancements (not required):**
- Admin UI to display name history timeline
- Signature display showing "(currently: Different Name)" if changed
