# 13: Service principals

**What to build:** An instance admin can create a service principal for CI with a required human owner, mint PATs for it under the human expiry rules (default 90 days, max 365), and grant it namespace and repo access through the normal authorization model. It is identified as `urn:mice:service|<uuid>`, shows as a service principal (with owner) in audit events, and the reserved issuer is rejected as an OIDC issuer at config load.

**Blocked by:** 12 (Service principal design review)

**Status:** ready-for-agent

- [ ] Admin can create and list service principals; non-admins cannot
- [ ] A service-principal PAT authenticates CI and is authorized like any Principal
- [ ] Audit events identify the service principal and its owner
- [ ] Config load fails if the OIDC issuer is the reserved service issuer
- [ ] An OIDC token can never produce a Session for a service principal
- [ ] Tested through the HTTP wiring seam; `mice` command to create and mint
