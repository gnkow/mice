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

Browser path: `web` → `/api` & `/auth` → **auth BFF** → **oxen-server**. Commit author `name`/`email` are injected from the session. Mutating calls append attributable events to `AUTH_DATA_DIR/audit.jsonl` (see **Audit** in the UI). Day-to-day CLI auth uses **`mice login`** (browser device pairing). Automation may still mint **CLI PATs** (`Profile → CLI tokens`).

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

#### Management commands

Everything the UI can do through `/auth/*` is also available from the CLI (JSON output; run `mice --help` for all flags): `authz`, `directory`, `access-request`, `training`, `audit` (`list|facets|export`), `lineage` (`query|rebuild`), `instance`, `namespace` (incl. `member`), `collaborator`, `role` (custom roles), `session`, `notifications`, `meta history|search`, and `job list --published`. These use an **unscoped** PAT (what `mice login` mints) acting as its owner; repo-scoped PATs are rejected, and AuthZ is still enforced server-side. Minting/revoking tokens and approving device logins remain browser-only.

#### Automation / CI (PAT)

```bash
# Profile → CLI tokens → Create token, then:
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

### Tags and labels from the CLI

Open a branch name in the repository's **Branches** list for its info, metadata,
and power tools (update tip or merge an incoming commit). Icon-only shortcuts in
the list link to history, files, metadata, comparisons, and power tools.
Text actions throughout the UI use leading icons, including dialogs and menus;
icon-only actions retain accessible labels and tooltips.
The main navigation and home tiles also have entity icons. File and folder row
menus include **Edit Metadata**. Workspace tabs are **Changes**, **Jobs** (not yet
implemented), **Sessions**, and **Metadata**; Changes combines staging, reviewing
changes, and committing into a branch on one page.

```bash
# Inside a clone, namespace/repo are filled in.
mice meta set repo --tag reviewed,gold --label env=prod --label owner=ml
mice meta set branch dev --label stage=staging
mice meta set file data/train.csv --scope repository --tag pii
mice meta set file data/train.csv --scope branch --revision dev --label owner=ml
mice meta set file data/train.csv --scope commit --revision <commit-id> --tag reviewed
mice meta set directory data --scope repository --untag draft --unlabel owner
mice meta set commit <id> --tag release
mice meta set workspace <id> --label owner=ml
mice meta set job <jobId> --tag nightly          # job/session ids are plain
mice meta get repo [--json]                     # annotations on this resource only
mice meta clear file data/train.csv --scope repository --yes # clear this scope only
# Commands that create an entity take --tag / --label (repeatable) directly:
mice commit -m "v2" --tag release --label qa=ok
mice branch dev --label stage=staging        # also: mice checkout -b dev --tag wip
mice create-remote acme/data --tag demo
mice job run --image alpine:3.20 --tag nightly -- touch out.txt   # applied when the job is published
# Outside a clone use full ids: ns/repo, ns/repo@branch, ns/repo#commit,
# ns/repo!workspace, ns/repo:path, ns/repo:dir/ (or pass --namespace/--repo).
```

Metadata is explicit-only: namespaces, repositories, branches, commits, folders
(`directory`), files, workspaces, jobs, and sessions each have independent tags and
labels. Nothing is inherited, propagated, or merged from another resource.
File/folder scopes are **general**, **specific branch**, or **specific commit**.
The CLI calls the general scope `--scope repository`; branch/commit scopes require
`--revision`. Each path/scope combination is independent, with no fallback to general
annotations. Commit IDs are shared across branches, not duplicated per branch.
There are no snapshots or historical metadata guarantees. Metadata remains attached
to its path after file deletion/recreation.

`--untag` and `--unlabel` delete entries; they do not create absence overrides.
Renaming removes the old name/key. Empty label strings remain present values.
The editor confirms tag merges and label replacement during renaming.
The API accepts `tags` as a replacement list and merges `labels` per key (`null`
deletes a label). Inheritance, propagation, and absence-override options are rejected.
Existing stores automatically retain explicit tags/labels and discard old active
inheritance rules and absence overrides; inherited values are not copied.
History and revision counters are preserved.

UI and CLI edits use revision checks; stale UI saves preserve drafts and require
loading and reviewing the latest metadata. Changes to another resource do not
invalidate an edit. Search covers all explicitly annotated resources visible to the
caller, and never returns a resource merely because its parent is annotated.
Metadata state, history, and monotonic revisions are
written together by atomic JSON replacement. This store requires **a single auth
process**; it does not support concurrent writers across processes or hosts. Read/write
failures are surfaced; history is retained without automatic compaction.

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

### Notifications

The avatar menu contains **Profile**, **Settings**, and **Sign out**. Profile
contains account identity, theme/diff colors, CLI tokens, and notification preferences.
Settings separates connection setup, access requests, authorization policy,
instance administrators, and delegated permissions. CLI examples are available
on demand in Profile.

The header bell opens your notification inbox. **Account menu → Profile**
opens preferences: event categories, delivery channels, email
digests, quiet hours/timezone, and resource watch/mute overrides. Inbox and online
toasts are enabled by default; email and browser push require explicit opt-in.
Personal access/security notices remain available even when you have no resource
grants. No notification category bypasses your global/category preferences.

Resource activity covers resources you can access, excludes routine self-edits,
and is checked again when displayed or delivered. A parent resource mute includes
descendants; a more specific watch overrides that mute but never grants access.
Previously delivered emails and desktop notifications cannot be recalled after
access revocation. Payloads may include resource names and event summaries, never
file contents or token secrets.

This implementation supports **one auth process only**. Persist and back up
`AUTH_DATA_DIR`; notification state and pending delivery survive restarts. The
audit journal supports replay after interrupted notification projection, but a
crash between a successful domain/upstream mutation and audit append can still
lose that event. Direct oxen-server writes and external IdP changes are not
notification sources. Users become known notification recipients after signing
in; offline group visibility is limited by saved identity claims.

The UI polls every 10 seconds. Notification content expires after 90 days;
audit retention is independent. Normal immediate delivery targets 30 seconds,
excluding quiet hours, digests, and provider/browser delays. Email/push need
administrator configuration; unavailable channels are shown in profile settings.
Browser push additionally requires browser permission and a secure context
(HTTPS in production; localhost for development).

Configure email with `NOTIFICATIONS_SMTP_URL` and `NOTIFICATIONS_EMAIL_FROM`.
For push, generate VAPID keys with `cd auth && npx web-push generate-vapid-keys`,
then set `NOTIFICATIONS_VAPID_PUBLIC_KEY`, `NOTIFICATIONS_VAPID_PRIVATE_KEY`, and
`NOTIFICATIONS_VAPID_SUBJECT` (a `mailto:` contact or HTTPS URL). Keep SMTP
credentials and private keys in deployment secrets; Compose forwards these
variables to auth. Daily digests use 09:00 in the profile timezone; weekly
digests use Monday at 09:00.

Administrators can publish an instance-wide announcement through
`POST /auth/notifications/announcements` with JSON `{ "title": "...",
"summary": "..." }`, a browser session cookie, and the deployment's `Origin`
header. There is no announcement-authoring page yet. Delivery failures are logged
with sanitized provider codes; pending/retry/dead status is retained in
`notifications.json`. External delivery is at least once and can duplicate a
message after an ambiguous provider response.

## Progress

Playwright case catalog: [`TESTS.md`](./TESTS.md). Local epic/design notes (AuthN, AuthZ, audit, GxP, Sessions) live under `plans/` when present (gitignored).
