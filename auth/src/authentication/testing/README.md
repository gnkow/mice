# Authentication test harness

Three owner-confirmed seams, nothing else: HTTP through the app (`createAuthTestApp`), the authentication façade, and the IdP adapter contract (`idpAdapter.contract.test.ts`).

## `createAuthTestApp({ idp, clock, db, audit })`

Returns `{ app, idp, clock, audit: { events }, login(key, { next?, authAgeSec? }), advance(ms), close() }`.

- `idp`: `{ users }` for the in-process fake IdP, or any `IdpAdapter` (`idpAdapter.ts`). A user spec sets `name` (`null` = missing claim), `guest`, `mfa` (amr `[pwd, otp]`, acr `mfa`, else `[pwd]`/`pwd`), `disabled`, `groups`.
- `clock`: BFF clock (default starts now). `Date`, `new Date()` and the process clock follow it; `advance(ms)` moves BFF and IdP together. `idp.setOffset(ms)` skews the IdP alone.
- `db`: `private-schema` (default) or `shared`. Needs Postgres up and `POSTGRES_PASSWORD_FILE`, `IMMUDB_PASSWORD_FILE`, `NOVU_PASSWORD_FILE` set.
- `audit`: custom `AuditFn`, else events are recorded in `audit.events`.
- `login(key)` runs `/auth/login`, the IdP sign-in and `/auth/callback`; `headers` carries the Session cookie.
- Always `after(() => t.close())`: it restores `Date`, the clock and the environment.

## Table-driven suite

See `authTestApp.test.ts`: one harness per file, `rows: { name, run(t) }[]`, one `it` per row. Add a row, not a test body.

## Container IdP

`auth/keycloak/realm-mice.json` ships a Keycloak realm. A container adapter implements `IdpAdapter` (`start`/`stop` run the container with the realm, `addUser` uses the admin API, `signIn` drives the login form and returns the callback `code`/`state`) and is added to `adapters` in `idpAdapter.contract.test.ts`. Not built yet.
