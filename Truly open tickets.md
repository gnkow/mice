# Open authentication tickets

The tracker is `.scratch/authentication/issues/`. This note replaces the audit that arrived on `to_merge`.

Ready for an agent: none. Issue 13 stays deferred.

`to_merge` stored revocation requests and back-channel `jti` values, and that work is kept. Its parallel access-state module is not: IdP disable, the 30-day restore, and Mice suspension already live in issues 19, 27, and 28. Identity reuse stays closed by ADR 0006 (issue 30). The recovery token stays unbuilt by ADR 0007 (issue 39): deletion cannot leave fewer than two instance admins.
