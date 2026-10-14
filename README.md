# Boxen

Open-source web UI for [Oxen](https://www.oxen.ai) / self-hosted [`oxen-server`](https://docs.oxen.ai/getting-started/oxen-server).

## Layout

| Path | Role |
| --- | --- |
| `compose.yaml` | Stack: `oxen-server`, `auth` (Hono BFF), `keycloak`, `web` |
| `auth/` | Auth BFF — OIDC/session, AuthZ, author injection, audit JSONL, proxy to oxen-server |
| `web/` | Vite + React + TypeScript UI |
| `TESTS.md` | Test plan + recommended frameworks for full coverage |

## Prerequisites

Oxen publishes the server image as a release tarball (not always pullable from a registry).

```bash
# Apple Silicon
curl -fsSL -o /tmp/oxen-server-docker-arm64.tar \
  -L "https://github.com/Oxen-AI/Oxen/releases/latest/download/oxen-server-docker-arm64.tar"
docker load < /tmp/oxen-server-docker-arm64.tar

# x86_64 — use oxen-server-docker-x86_64.tar instead
```

## Run

```bash
cp .env.example .env   # optional
cd auth && npm install && cd ..   # host tooling / IDE; Compose installs Linux deps in the auth volume
docker compose up --build
# → UI        http://localhost:5173
# → Auth BFF  http://localhost:8080
# → Keycloak  http://localhost:8180  (admin/admin; user boxen / boxen)
# → oxen API  http://localhost:3001  (direct; browser uses BFF)
```

Sign in: open **http://localhost:5173/login** (use `localhost`, not `127.0.0.1`, so OIDC redirects match) → **Sign in with SSO** (Keycloak user `boxen` / `boxen`), or **Dev login** when `AUTH_DEV_MODE=true`. Sign out clears the Boxen session and the Keycloak SSO session so the next SSO prompt asks for credentials again. When adding namespace members, repo collaborators, or instance admins, Settings supports **IdP directory search** (Keycloak Admin API when `KEYCLOAK_ADMIN_URL` is set, plus known AuthZ principals).

Browser path: `web` → `/api` & `/auth` → **auth BFF** → **oxen-server**. Commit author `name`/`email` are injected from the session. Mutating calls append attributable events to `AUTH_DATA_DIR/audit.jsonl` (see **Audit** in the UI).

### Oxen CLI (through the BFF)

```bash
# Settings → CLI tokens → Create token, then:
oxen config --auth localhost:8080 boxen_pat_…
oxen clone http://localhost:8080/<namespace>/<repo>
```

Do not use raw `localhost:3001` as the product remote (that port is for e2e/helpers only).

## Tests

```bash
make up         # start stack
make test       # headless E2E (auto dev-login)
make smoke      # smoke suite only
make test-view  # headed + slow-mo (watch in browser)
make clean      # stop stack, wipe volumes + deps + test artifacts
```

Atomic E2E case catalog: [`TESTS.md`](./TESTS.md).

## Progress

Playwright case catalog: [`TESTS.md`](./TESTS.md). Local epic/design notes (AuthN, AuthZ, audit, GxP) live under `plans/` when present (gitignored).
