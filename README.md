# Mice

Open-source web UI for [Oxen](https://www.oxen.ai) / self-hosted [`oxen-server`](https://docs.oxen.ai/getting-started/oxen-server).

## Layout

| Path | Role |
| --- | --- |
| `compose.yaml` | Stack: `oxen-server`, `auth` (Hono BFF), `keycloak`, `web` |
| `auth/` | Auth BFF — OIDC/session, AuthZ, author injection, audit JSONL, proxy to oxen-server |
| `web/` | Vite + React + TypeScript UI |
| `cli/` | `mice` CLI — login/logout + Oxen command passthrough via the BFF |
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
# → Keycloak  http://localhost:8180  (admin/admin; user mice / mice)
# → oxen API  http://localhost:3001  (direct; browser uses BFF)
```

Sign in: open **http://localhost:5173/login** (use `localhost`, not `127.0.0.1`, so OIDC redirects match) → **Sign in with SSO** (Keycloak user `mice` / `mice`). Sign out clears the Mice session and the Keycloak SSO session so the next SSO prompt asks for credentials again. When adding namespace members, repo collaborators, or instance admins, Settings supports **IdP directory search** (Keycloak Admin API when `KEYCLOAK_ADMIN_URL` is set, plus known AuthZ principals).

Browser path: `web` → `/api` & `/auth` → **auth BFF** → **oxen-server**. Commit author `name`/`email` are injected from the session. Mutating calls append attributable events to `AUTH_DATA_DIR/audit.jsonl` (see **Audit** in the UI). Day-to-day CLI auth uses **`mice login`** (browser device pairing). Automation may still mint **CLI PATs** (`Settings → CLI tokens`).

### Mice CLI (through the BFF)

Requires the [Oxen CLI](https://docs.oxen.ai) on `PATH`. From the repo root (or after `npm link`):

```bash
# Interactive login — opens the UI to approve a device code (no PAT copy-paste)
mice login
mice clone http://localhost:8080/<namespace>/<repo>
mice whoami
# …any other oxen subcommand:
mice status
mice push origin main
```

`mice` forwards Oxen commands to the `oxen` binary after configuring Bearer auth for the BFF host. Do not use raw `localhost:3001` as the product remote (that port is for e2e/helpers only).

#### Automation / CI (PAT)

```bash
# Settings → CLI tokens → Create token, then:
export MICE_PAT=mice_pat_…
# or:
oxen config --auth localhost:8080 mice_pat_…
oxen clone http://localhost:8080/<namespace>/<repo>
```

### Local jobs CLI

Local jobs run Docker on your machine. Metadata is cached under `~/.mice/jobs/` (not in the repository). When you `mice push` (through the auth BFF), job metadata for result commits on the tip is published automatically — no separate sync step:

```bash
# From the repo root (links the `mice` binary), or: npm link
npm install
mice login   # or: export MICE_PAT=… MICE_REMOTE=http://localhost:8080

# From inside an oxen clone (ns/repo/source autodected):
mice clone http://localhost:8080/<ns>/<repo>
cd <repo>

# Local-only run (no remote/UI entry yet):
mice job run \
  --image alpine:3.20 \
  -- touch out.txt

# Push commits via BFF — also publishes pending job metadata:
mice push

# Or combine: mice job run --push --image alpine:3.20 -- touch out.txt

mice job list              # local cache for this clone
mice job reset --yes       # clear stuck/failed local job (+ confirm unless --yes)
mice job status --id <jobId>
mice job logs --id <jobId>
```

### Use another OIDC IdP

Compose ships Keycloak for local SSO. The BFF speaks standard OIDC Authorization Code + PKCE; any IdP that supports that flow works.

1. Register a confidential (or public) client with:
   - **Redirect URI:** `http://localhost:5173/auth/callback` (or your deployed UI origin + `/auth/callback`)
   - **Post-logout redirect:** `http://localhost:5173/login` (must match `OIDC_POST_LOGOUT_REDIRECT_URI`)
   - **PKCE:** S256
   - Scopes: `openid` (profile/email recommended)
2. Set these on the `auth` service (via `.env` / Compose overrides):

   | Variable | Purpose |
   | --- | --- |
   | `OIDC_ISSUER` | Issuer URL the **BFF** uses for discovery (container-reachable) |
   | `OIDC_ISSUER_PUBLIC` | Issuer/authorize host the **browser** uses (if different from `OIDC_ISSUER`) |
   | `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | Client credentials |
   | `OIDC_REDIRECT_URI` | Must match the IdP allow-list |
   | `OIDC_POST_LOGOUT_REDIRECT_URI` | RP-initiated logout return URL |
   | `OIDC_GROUPS_CLAIM` | Id token claim for groups (default `groups`) |

3. Directory search is Keycloak-specific today. For Entra / Okta / etc., set `DIRECTORY_PROVIDER=none` (pickers still find principals already stored in AuthZ). Optional: leave the `keycloak` service stopped (`docker compose up --build --scale keycloak=0` or remove it from your override).
4. Bootstrap the first instance admin with `AUTHZ_BOOTSTRAP_ADMINS=<email-or-sub>` matching an IdP user. Keep `AUTHZ_DEV_GRANT_ALL` off outside local/e2e.

Example `.env` fragment (Entra-style issuer; adjust tenant/app values):

```bash
OIDC_ISSUER=https://login.microsoftonline.com/<tenant>/v2.0
OIDC_ISSUER_PUBLIC=https://login.microsoftonline.com/<tenant>/v2.0
OIDC_CLIENT_ID=<app-id>
OIDC_CLIENT_SECRET=<secret>
OIDC_REDIRECT_URI=https://mice.example.com/auth/callback
OIDC_POST_LOGOUT_REDIRECT_URI=https://mice.example.com/login
OIDC_GROUPS_CLAIM=groups
DIRECTORY_PROVIDER=none
AUTHZ_BOOTSTRAP_ADMINS=admin@example.com
AUTHZ_DEV_GRANT_ALL=false
```

## Tests

```bash
make up              # start stack
make test-unit       # auth + CLI + web unit tests (+ live BFF integration if up)
make test-cli        # CLI/PAT/device Playwright suite (stack must be up)
make test            # full Playwright E2E
make smoke           # smoke suite only
make test-view       # headed + slow-mo (watch in browser)
make clean           # stop stack, wipe volumes + deps + test artifacts
```

Atomic E2E case catalog: [`TESTS.md`](./TESTS.md).

### Desktop sessions (PLAT-SESS)

Interactive Linux desktops (exclusive per user). Default local stack uses the **docker** provisioner (XFCE+xrdp via `lscr.io/linuxserver/rdesktop`). Connect uses **guacamole-lite** + `guacd`. Create-time **multi-mount** of Oxen workspaces/commits under `/data/<ns>/<repo>` (AuthZ mirrors Jobs read/write). UI: **Sessions** in the nav. Use `SESSIONS_PROVISIONER=mock` only for fast API/UI e2e (Connect is disabled — no RDP host).

```bash
make up                 # includes guacd; real desktops by default
make test-sessions      # Playwright (set SESSIONS_PROVISIONER=mock for speed)
```

Plan: [`plans/Sessions.md`](./plans/Sessions.md).

## Progress

Playwright case catalog: [`TESTS.md`](./TESTS.md). Local epic/design notes (AuthN, AuthZ, audit, GxP, Sessions) live under `plans/` when present (gitignored).
