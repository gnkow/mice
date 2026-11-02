Status: wontfix

# 30: Identity reuse detection

**Spec:** `.specs/01-authentication.md` (S8)

**Decision:** [ADR 0006](../../../docs/adr/0006-idp-guarantees-unique-human.md)

Previously filed as `08-identity-reuse-detection.md`. Name changes for the same person stay issue 22.

## Outcome

The IdP already validates that each user is unique and linked to a human. Mice trusts `iss`+`sub` as that binding. It does not compare a second person attribute, refuse a reissued `sub`, open an identity-reuse incident, or require an admin-signed link. A known `iss`+`sub` stays the same Principal. A new `sub` is a new Principal.

## Acceptance

- [x] Uniqueness of the user and the link to a human stay an IdP validation, recorded in ADR 0006
- [x] Mice does not add a reuse check, an incident, or a rehire-link ceremony
