Status: done

# 02: Web login tracer

**Spec:** `.specs/01-authentication.md` (stories 1 and 14, Q49, Q52, Q54)

A missing name claim is issue 32.

## Outcome

A user logs in through the IdP and receives an opaque server-side session cookie. The BFF resolves the Principal by canonical `iss`+`sub`. Login state in Postgres is single-use and expires after 10 minutes. The id_token signature is verified with a JWKS fetch on every verification (`cache: no-store`). The cookie is `__Host-mice_session`, `Secure`, `HttpOnly`, `SameSite=Lax`, with no `Domain` and `Path=/`.

## Acceptance

- [x] Login, callback, and `/me` work against the test IdP
- [x] Login state is single-use; replay, expiry, and tampering are rejected
- [x] Forged or wrongly signed tokens are rejected; clock leeway applies to token validity only
- [x] The cookie is `__Host-`, Secure, SameSite=Lax; the id is opaque; the session row is server-side
- [x] Principal identity uses a canonical issuer, an internal id, and a unique `iss`+`sub` key

## Code

- `auth/src/authentication/oidc/loginFlow.ts`
- `auth/src/authentication/oidc/oidc.ts` (`keySet` fetches JWKS on every call)
- `auth/src/authentication/session/session.ts`
- `auth/src/env.ts` (`cookieName` defaults to `__Host-mice_session`)
