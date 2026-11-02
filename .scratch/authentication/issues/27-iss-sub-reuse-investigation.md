# 27: iss+sub reuse investigation

**What to build:** Decide and specify how Mice detects an IdP reissuing an existing `iss`+`sub` to a different person, refuses that login, raises an incident, and follows rehire logic (spec S8). This needs product/IdP-owner input before it can be implemented safely.

**Blocked by:** None (investigation); implementation depends on the decision below.

**Status:** needs-info

## Why this is separate

Ticket 04 originally carried a criterion to refuse login and raise an incident when `iss`+`sub` is reused. Detecting reuse reliably needs facts that are not in the repo:

- Does the IdP guarantee that `sub` is never reissued, or can an operator reuse it?
- Which claim proves the human is the same person across identities (for rehire, the same email with a new `sub`)?
- Should a rehire keep any grants, or must an admin explicitly re-grant everything?
- Where should the incident go (audit event, notification, pager, compliance ticket)?

Without those answers, heuristic email comparison would create false positives (legal name/email changes) and false negatives (recycled addresses).

## Decision needed

- [ ] Confirm IdP `sub` reuse policy and the identity evidence available at login.
- [ ] Define the reuse incident channel and payload.
- [ ] Define rehire behaviour (spec S8): new `sub`, same person; no automatic grant transfer.
- [ ] Decide whether any existing `principals` row can ever be re-bound or must stay immutable.

## Links

- Ticket 04 defers this criterion here.
- `auth/src/authentication/session/session.ts` (`ensurePrincipal`) is the current identity-of-record write point.
- `auth/src/authentication/session/principal.ts` (`principalKey`) defines the identity key.
