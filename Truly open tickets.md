# Open authentication tickets

The tracker is `.scratch/authentication/issues/`. This note replaces the audit that arrived on `to_merge`.

Ready for an agent: 34, 35, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48.

Issue 41 waits on 40. Issue 13 stays deferred.

`to_merge` stored revocation requests and back-channel `jti` values, and that work is kept. Its parallel access-state module is not: IdP disable, the 30-day restore, and Mice suspension already live in issues 19, 27, and 28. Identity reuse stays closed by ADR 0006 (issue 30).
