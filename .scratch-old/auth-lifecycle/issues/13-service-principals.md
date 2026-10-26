# 13: Service principals

**What to build:** An instance admin can create a service principal for CI with a required human owner, mint PATs for it under the human expiry rules (default 90 days, max 365), and grant it namespace and repo access through the normal authorization model. It is identified as `urn:mice:service|<uuid>`, shows as a service principal (with owner) in audit events, and the reserved issuer is rejected as an OIDC issuer at config load.

**Blocked by:** 12 (Service principal design review)

**Status:** done

- [x] Admin can create and list service principals; non-admins cannot
- [x] A service-principal PAT authenticates CI and is authorized like any Principal
- [x] Audit events identify the service principal and its owner
- [x] Config load fails if the OIDC issuer is the reserved service issuer
- [x] An OIDC token can never produce a Session for a service principal
- [x] Tested through the HTTP wiring seam; `mice` command to create and mint
