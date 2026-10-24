# SAML via Keycloak brokering

The BFF is OIDC-only. SAML IdPs are brokered by Keycloak, which presents them to the BFF as OIDC.

## Dev setup (compose)

- `auth/keycloak/realm-partner-saml.json` — a stand-in SAML IdP realm `partner-saml` (user `partner`/`partner`, group `partner-staff`). It has a SAML client for the mice realm.
- `auth/keycloak/realm-mice.json` — the `partner-saml` identity provider (alias `partner-saml`, "Partner (SAML)") and its mappers.

## Steps for a real IdP

1. In the mice realm, add a SAML v2.0 identity provider; import the IdP metadata (SSO URL, signing cert) and enable `validateSignature`.
2. Set NameID format to email; set `trustEmail` only if the IdP is authoritative for email, so the `email_verified` claim is true.
3. Add attribute mappers: `email`, `firstName`, `lastName` (so first-broker-login skips the profile review).
4. Map the IdP group attribute to the `groups` claim (attribute importer into a user attribute plus the realm's groups mapper, or a hardcoded group per IdP). Use `syncMode: FORCE` so groups refresh on every login.
5. Give the IdP the Keycloak SP metadata: `{issuer}/broker/<alias>/endpoint/descriptor`.

The BFF needs no change: the brokered user logs in as a normal OIDC Principal (`iss` is the mice realm). Covered by `e2e/tests/saml-broker.spec.ts` (TC-AUTH-SAML-01).
