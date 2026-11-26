# Auth package layout

Composition: `src/{index,app,boot}.ts` + `src/db/**` + `src/packages/*`.

Tests live in `auth/tests/` (sibling of `src/`), grouped by package name where applicable.

There are **no** strangler shims under `src/`. Import domain code from `src/packages/<name>/` entry points (`index.ts` / `routes.ts`) or, when needed, that package’s `lib/` modules.
