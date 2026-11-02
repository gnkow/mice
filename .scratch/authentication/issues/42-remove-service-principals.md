Status: ready-for-agent

# 42: Remove service principals

**Spec:** `.specs/01-authentication.md` (Q12, Q13, Q14, consolidated position)

**Blocked by:** none

Jobs use the BFF-internal token in `.scratch/jobs/issues/02-job-token-lifetime-and-commit-hold.md`. They are not service principals.

## What to build

Mice has no service-principal issuer, no service-principal records, and no route that creates or authenticates one. Automated work is attributed to the submitting human plus the job marker from `.scratch/jobs/issues/01-job-commit-attribution.md`.

## In code today

`SERVICE_ISSUER` is `urn:mice:service`. `principal.ts` treats that issuer as kind `service`. `servicePrincipals.ts` can suspend principals owned by a revoked human. Startup rejects an OIDC issuer equal to `SERVICE_ISSUER`, which keeps the reserved issuer in the product.

## Acceptance

- [ ] No route creates a service principal or accepts `urn:mice:service` as a caller
- [ ] Owner-revoke no longer cascades to service principals, because none exist
- [ ] Tests that authenticated as a service principal use a human session instead
- [ ] `kindOf` no longer has a service kind
