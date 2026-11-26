---
status: accepted
---

# Auth BFF domain code lives in deep-module packages

The `auth/` BFF organises domain behaviour as **deep modules** under `auth/src/packages/<name>/`. Each package's public surface is its **root entry-point files** only; implementation lives in subfolders (conventionally `lib/`) and is not imported from outside the package. Composition stays in `app.ts` / `boot.ts`; shared Postgres access stays in `db/` with stores talking to Drizzle directly.

This does **not** reopen ADR 0004: there is still no generic persistence port and no second database adapter for relational state. Package seams hide domain orchestration and HTTP route wiring, not the main database.

## Entry points

- **Composition** (`app.ts` / `boot.ts` / `routes.ts`) may import a package's fat `index.ts`.
- **Leaf faces** (e.g. `principal.ts`, `types.ts`, `append.ts`) exist where lower layers need a small surface without pulling the whole package.
- Cross-package **cycles** that need runtime collaborators use **init-at-boot** (e.g. `initAuditOutage`, `initWorkspaces`) instead of bridge files per edge.

## Considered options

- Keep a flat `auth/src/*.ts` root: fastest to add files, but callers reach internals freely and unrelated features break together.
- One thin re-export file per lib module: satisfies boundaries, but explodes file count without adding depth.
- Introduce a repository/port layer over Postgres: conflicts with ADR 0004 and adds a single-adapter seam without a second real adapter.

## Consequences

- Dependency-cruiser enforces entry-point boundaries (`lint:boundaries`); violations are errors.
- Package-root entry points are opaque to the cycle walker so fat `index` barrels do not create phantom cycles; real cycles inside `lib/` still fail.
- Fat route and god modules shrink to thin adapters over package `lib/` implementations.
