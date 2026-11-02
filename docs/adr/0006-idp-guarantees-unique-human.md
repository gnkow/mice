---
status: accepted
---

# The IdP guarantees a unique human per `iss`+`sub`

Mice does not detect identity reuse. The IdP already validates that each user is unique and linked to one human, so `iss`+`sub` is that binding. A login with a known `iss`+`sub` is the same Principal, including after a name change, an email change, or the IdP re-enabling the account. A new `sub` is a new Principal. Mice does not refuse login for a suspected reissue, open an identity-reuse incident, or require an admin-signed link before grants exist on a new `sub`.

## Considered options

- Compare a second person claim and refuse login when it changes (spec S8): Mice would need a claim the IdP does not send, and a name or email change is already a normal update for the same person.
- Trust the IdP validation: the uniqueness and human-link checks already exist there.

## Consequences

- Issue 30 is closed. Spec S8's incident and rehire-link ceremony are not implemented.
- Shared or role accounts are excluded by the same IdP validation, not by a Mice claim check.
