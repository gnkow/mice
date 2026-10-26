# 07: SAML via Keycloak brokering recipe

**What to build:** A documented, tested way to sign in with a SAML IdP. The BFF stays OIDC-only; a SAML IdP is brokered through Keycloak. Ship one recipe in the docs and one Playwright case that logs in through a brokered identity provider.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] The recipe documents realm, broker and claim-mapping steps, including `email_verified` and the groups claim
- [x] A Playwright case signs in through the brokered path and lands in the app as the expected Principal
- [x] No SAML code is added to the BFF
- [x] The authentication plan's SAML item is updated to point at the recipe
