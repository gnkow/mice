# CLI — PLAT-CLI implementation plan

Living design and plan for epic `PLAT-CLI` ("mice CLI"): the `mice` command-line client that wraps the `oxen` binary with BFF authentication, runs local jobs, and exposes the BFF's `/auth/*` management API as JSON commands. The CLI shipped incrementally alongside other epics and had no plan of its own; this document records what exists (verified in code) and what is proposed.

Related: [EPICS.md](./EPICS.md) · [01-authentication.md](./01-authentication.md) · [02-authorization.md](./02-authorization.md) · [03-audit.md](./03-audit.md) · [05-repositories.md](./05-repositories.md) · [06-data-transfer.md](./06-data-transfer.md) · [08-workspaces.md](./08-workspaces.md) · [09-jobs.md](./09-jobs.md) · [10-sessions.md](./10-sessions.md) · [11-lineage.md](./11-lineage.md) · [12-metadata-search.md](./12-metadata-search.md) · [13-favorites.md](./13-favorites.md) · [14-notifications.md](./14-notifications.md) · [README.md](../README.md) (§ "Mice CLI")

## 1. Purpose & scope

**In scope**

- Login/logout/whoami against the auth BFF via the device-code flow (no PAT copy-paste)
- Transparent `oxen` passthrough with the BFF as the only remote (never raw oxen-server `:3001`)
- Local Docker jobs (`mice job …`) and publishing job metadata on `mice push`
- JSON management commands that mirror the web UI's `/auth/*` calls
- Entity metadata (tags/labels) via `mice meta` and `--tag`/`--label` on creating commands
- CLI structure: command registry, help, completion, distribution, compatibility, CI mode (proposed)

**Out of scope (this document)**

- Server endpoints and their authorization — see the owning plans (§8)
- The Oxen CLI itself and its protocol (Mice only shells out to it)
- Token minting/revoking and device approval — deliberately browser-only ([`web/src/pages/CliDevicePage.tsx`](../web/src/pages/CliDevicePage.tsx))

## 2. Current state

Single-file entry [`cli/mice.mjs`](../cli/mice.mjs) (1085 lines) plus helpers in [`cli/lib/`](../cli/lib/). Plain Node ESM, no build step, no dependencies of its own. Exposed as the `mice` bin in the root [`package.json`](../package.json) (`"bin": { "mice": "./cli/mice.mjs" }`; also `npm run mice`). `cli/` has no `package.json`; `MICE_VERSION` is a hard-coded `'0.2.0'` constant in `mice.mjs`, unrelated to the root package version.

| Piece | Behavior | Code |
| --- | --- | --- |
| Dispatch | One `main()` with an `if` chain: `login`/`logout`/`whoami`/`remote`/`version`, `job`, admin groups, `meta`, then oxen passthrough | `cli/mice.mjs` |
| Help | Hand-written `usage()` text printed to **stderr**; `-h`, `--help`, `help` or no args exit `0`, usage errors exit `1` | `cli/mice.mjs` |
| Arg parsing | Three parsers: `parseArgs` (jobs), `parseAdminArgs` (repeatable flags), `parseMetaArgs`; plus `parseLoginFlags` in `mice.mjs` | `cli/lib/args.mjs`, `admin.mjs`, `meta.mjs` |
| Login | Device flow: `POST /auth/cli/device/start`, open browser (`--no-open` to skip), poll `/auth/cli/device/poll` honoring `slow_down`; needs `oxen` on PATH | `cli/lib/login.mjs`, `cli/lib/open.mjs`, `auth/src/cliDevice.ts` |
| Passthrough | Rewrites `:3001` URLs to the BFF remote, refuses a `:3001` remote, runs `oxen config --auth <host> <token>` then spawns `oxen` with inherited stdio | `cli/lib/oxen.mjs` |
| Admin groups | 15 groups (§3.3) → `buildRequest` produces a plain request object, `runAdmin` sends it with the PAT and prints JSON | `cli/lib/admin.mjs` |
| Jobs | Local Docker runner with local store, `reset`, published listing | `cli/lib/docker.mjs`, `localStore.mjs`, `publish.mjs` |
| Metadata | `meta get/set/clear/history/search`, create-time `--tag`/`--label` | `cli/lib/meta.mjs` |

## 3. Command inventory (verified against `cli/mice.mjs` usage + dispatch)

### 3.1 Session and environment

| Command | Notes |
| --- | --- |
| `mice login [--remote URL] [--no-open]` | Device code; stores credentials, runs `oxen config --auth` and `oxen config --name/--email` |
| `mice logout` | `POST /auth/cli/logout` (404 tolerated), then clears local credentials |
| `mice whoami` | `GET /auth/cli/whoami`; prints name, email, `sub`, authz summary, remote (plain text, not JSON) |
| `mice remote` | Prints resolved remote, auth host, `credentials: present\|none` |
| `mice version` / `--version` / `-V` | `mice 0.2.0` and the `oxen` version, or `oxen: not found on PATH` |

### 3.2 Oxen passthrough and local jobs

| Command | Notes |
| --- | --- |
| `mice <any oxen command>` | Anything not matched above goes to `oxen`; exit code is oxen's (`127` if missing) |
| `mice commit/branch/checkout -b/create-remote … --tag --label` | Creation detection (`detectCreation`) strips the flags, then applies metadata after oxen succeeds |
| `mice push` | Passthrough, then `publishJobsAfterPush` for matching local jobs; publish failure sets exit `1` |
| `mice job run --image <img> [--source] [--name] [--push] [--tag] [--label] [--timeout] [--cpu] [--memory] -- <cmd…>` | Requires a clean worktree and Docker; auth only needed with `--push` (`--sync` is an alias) |
| `mice job list` | Local jobs by default; `--published [--all] [--status] [--limit] [--cursor] [--pin]` queries `GET /auth/jobs` |
| `mice job status\|logs --id` | Local store first, then `GET /auth/jobs/:id[/logs]` |
| `mice job cancel --id` | Local-only job → marked cancelled locally; published job → `POST /auth/jobs/:id/cancel` |
| `mice job reset [--id\|--all] [--purge] [--yes]` | Marks BFF job failed via `/complete`, cleans work dir, may `oxen restore` a dirty worktree; confirmation required |
| `mice job sync` | Removed; prints a pointer to `mice push` |

### 3.3 Management groups (`ADMIN_GROUPS` in `cli/lib/admin.mjs`)

All print JSON (audit export prints CSV text or writes `--out`). They require an **unscoped** PAT; scoped PATs are rejected server-side (README § Management commands). Most accept `--remote`/`--token`.

| Group | Subcommands (per help) | Owning plan |
| --- | --- | --- |
| `authz` | effective permissions | [02-authorization.md](./02-authorization.md) |
| `directory` | `<query> [--kind user\|group]` | [02-authorization.md](./02-authorization.md) |
| `access-request` | `submit`, `list`, `approve`, `deny` | [02-authorization.md](./02-authorization.md) |
| `training` | `set [--revoke]` | [04-gxp-compliance.md](./04-gxp-compliance.md) |
| `audit` | `list`, `facets`, `export` | [03-audit.md](./03-audit.md) |
| `lineage` | `query`, `rebuild` | [11-lineage.md](./11-lineage.md) |
| `instance` | `show`, `enforce on\|off`, `admin add\|remove`, `permissions set` | [02-authorization.md](./02-authorization.md) |
| `namespace`, `collaborator`, `role` | CRUD, `member set\|remove`, custom roles | [02-authorization.md](./02-authorization.md), [05-repositories.md](./05-repositories.md) |
| `session` | templates, retention, list/create/show/connect/disconnect/retry/stop/mounts/remount/destroy | [10-sessions.md](./10-sessions.md) |
| `workspace` | `list`, `show`, `changes`, `delete`, `create` | [08-workspaces.md](./08-workspaces.md) |
| `notifications` | list, unread-count, read/unread, read-all, preferences, resource-overrides, `announce` | [14-notifications.md](./14-notifications.md) |
| `favorite` | `list`, `add`, `remove` (id defaults from clone) | [13-favorites.md](./13-favorites.md) |
| `announcement` | `list`, `create`, `enable\|disable\|delete` (instance admin) | [14-notifications.md](./14-notifications.md) |

`mice meta get|set|clear|history|search` is a separate dispatch (`cmdMeta`) over 9 entity types (`META_TYPES`) — see [12-metadata-search.md](./12-metadata-search.md). There is **no** top-level `stage` command; `--stage-id` exists only as an `audit` filter.

## 4. Auth resolution, config and state

**Token** (`resolveToken` in `cli/lib/config.mjs`): `MICE_PAT` env, else `token` in `credentials.json`. Admin/job/meta commands also accept `--token` (`resolveAuth` in `mice.mjs`: flag first, then `resolveToken()`); missing token prints "Not logged in…" and exits `1`.

**Remote** (`resolveRemote`): `MICE_REMOTE` env, then `--remote`, then `config.json` `remote`, then `http://localhost:8080`. Note the env var **outranks** the flag.

**Remote detection**: `looksLikeDirectOxenServer` (port `3001`) blocks passthrough; `rewriteArgsForBff` rewrites such URLs in argv; `detectRemote`/`parseRemoteUrl` derive `namespace`/`repo` from the clone's oxen remote; `findOxenRoot` locates the clone.

| Path | Env override | Contents |
| --- | --- | --- |
| `~/.config/mice/config.json` | `MICE_CONFIG_DIR` | `remote`, `authHost`, `patId`, `loggedInAt` |
| `~/.config/mice/credentials.json` (mode `0600`, atomic write) | `MICE_CONFIG_DIR` | plaintext PAT, `remote`, `authHost`, `patId` |
| `~/.mice/jobs/<sha256(root)[:16]>/<jobId>/` | `MICE_HOME` | local job metadata, logs, work dir (legacy `<clone>/.mice/jobs` read) |
| oxen user config | — | auth token per host and user name/email written by `oxen config` |

README and the usage text say `MICE_HOME (default ~/.mice)`; credentials actually live under `~/.config/mice` and are not affected by `MICE_HOME` (doc drift, see §9).

**Device flow server side** (`auth/src/cliDevice.ts`, routes in [`auth/src/cliDeviceRoutes.ts`](../auth/src/cliDeviceRoutes.ts)): 10-minute device TTL, `interval` default, `slow_down` throttling, approve/deny need a browser session; `GET /auth/cli/device` redirects to `/cli/device` ([`web/src/pages/CliDevicePage.tsx`](../web/src/pages/CliDevicePage.tsx)). PATs are minted as `mice_pat_*` with `source: 'cli-login'` ([`auth/src/tokens.ts`](../auth/src/tokens.ts)); default 90-day expiry — details in [01-authentication.md](./01-authentication.md).

**Reasons (breaking, CLI 0.2.0).** The BFF rejects mutations without a reason (see [03-audit.md](./03-audit.md)). `--reason <text>` is accepted on every admin group command (sent as `X-Mice-Reason` on non-GET requests), on `job run --push`, and on any oxen passthrough command (`mice push --reason …`): oxen cannot send headers, so the CLI strips the flag and calls `POST /auth/reason` first (declaration lasts 15 minutes, counts as an explicit reason). A `400` with `reason_required`/`reason_too_short` is shown with a hint to use `--reason` or a longer commit message. Code: `cli/lib/reason.mjs`.

## 5. Output conventions and exit codes

- **Output**: JSON (2-space) on stdout for `job`, `meta`, admin groups and `reset`; plain text for `login`, `logout`, `whoami`, `remote`, `version`, `job logs`, and CSV for `audit export`. Diagnostics and `mice:` prefixed messages go to stderr. No `--output`/`--json` switch (except `meta get --json`).
- **Exit codes**: `0` success; `1` usage errors, API errors (`api()` throws `"<status>: <msg>"`), failed jobs, failed publish/meta follow-up, refused destructive action without TTY; `127` oxen missing; otherwise oxen's own code. Set via `process.exitCode` in most paths and `process.exit(1)` in job/usage paths. Codes are not distinguished by cause (auth vs network vs usage).
- **Confirmation**: `confirmOrExit` (`cli/lib/confirm.mjs`) for `job reset`, `namespace delete`, `role delete`, `session destroy`, `workspace delete`; `--yes`/`-y` or `MICE_YES=1` skips; no TTY without `--yes` fails closed. `meta clear` is separate: it just requires `--yes` (no prompt).
- **Telemetry**: none in code.

## 6. Test coverage

| Layer | What | Where |
| --- | --- | --- |
| Unit (node:test) | Request building (`admin`), config/env resolution, local store, meta parsing/resolution, oxen URL parsing/rewrite, publish ref parsing | `cli/lib/{admin,config,localStore,meta,oxen,publish}.test.mjs`; run with `npm run test:unit:cli` (`scripts/test-fail-fast.mjs --dir cli/lib`) |
| Integration | Live stack: device start → approve (sealed session cookie) → poll; skips when `AUTH_URL` is down | `cli/integration/device-login.test.mjs`; `npm run test:cli:integration` |
| E2E (Playwright) | PAT on `/api`, author injection, revoke, Profile token UI, Clone box, `/auth/cli-info`, device flow API and UI | `e2e/tests/cli-auth.spec.ts` (TC-CLI-01…07), `e2e/tests/cli-device-ui.spec.ts` (TC-CLI-08…15); `npm run test:e2e:cli` |
| Not covered | `mice.mjs` dispatch and `usage()`, `login.mjs`, `api.mjs`, `args.mjs`, `confirm.mjs`, `docker.mjs`; real `oxen`/Docker execution; no test that help text matches handled commands |  |

## 7. Phased checklist

### Phase 1 — Auth + passthrough (shipped)

- [x] `mice login` device-code flow with browser open, `slow_down`, expiry, deny handling (`cli/lib/login.mjs`)
- [x] `logout` revokes server-side then clears local credentials; `whoami`; `remote`; `version`
- [x] `MICE_PAT` / `MICE_REMOTE` for automation (`cli/lib/config.mjs`)
- [x] Credentials file mode `0600`, atomic writes
- [x] Passthrough with `oxen config --auth` and `:3001` guard/rewrite (`cli/lib/oxen.mjs`)

### Phase 2 — Local jobs (shipped; see [09-jobs.md](./09-jobs.md))

- [x] `job run/list/status/logs/cancel/reset`, clean-worktree preflight, local store under `MICE_HOME`
- [x] Publish job metadata after `mice push`; `job list --published`
- [x] Destructive-action confirmation with `--yes` / `MICE_YES`

### Phase 3 — Management + metadata (shipped)

- [x] 15 admin groups mapped to `/auth/*` with JSON output (`cli/lib/admin.mjs`)
- [x] `mice meta` get/set/clear/history/search; `--tag`/`--label` on commit/branch/create-remote
- [x] Browser-only token mint/revoke and device approval

### Phase 4 — Structure and UX (proposed, not approved)

- [ ] **Command registry (proposed, not approved; deliberately deferred).** Replace the `if` chain in `main()` and the hand-written `usage()` in `cli/mice.mjs` with a registry: each command declares `name`, `summary`, flags, auth requirement (`none|pat|unscoped-pat`), confirm policy and handler. Help text, `ADMIN_GROUPS`, and unknown-command errors derive from it. Pair with **shared test discovery**: one parametrised test that every registered command has help and a handler, and that every help line maps to a registered command (replacing per-file hand lists). Deep-module candidate: small interface (`register`, `dispatch`, `render help`) hiding three arg parsers, auth resolution and error/exit mapping.
- [ ] Unify the three arg parsers behind the registry's flag declarations
- [ ] `mice help <command>` and per-command `--help` (currently one global text on stderr)
- [ ] Shell completion (`mice completion bash|zsh|fish`), generated from the registry
- [ ] `--output json|table|yaml` (and `--quiet`); make `whoami`/`remote`/`version` machine-readable
- [ ] Distinct exit codes (usage `2`, auth `3`, network `4`, server `5`) documented in `--help`
- [ ] Non-interactive/CI mode: `MICE_NONINTERACTIVE=1` disables browser open and prompts; `mice login --pat-stdin` is **not** proposed (PAT minting stays browser-only)

### Phase 5 — Distribution and compatibility (proposed, not approved)

- [ ] Publish an installable package (npm `@…/mice`) with its own `package.json` and version; derive `MICE_VERSION` from it
- [ ] Optional single-file binary (e.g. Node SEA) for hosts without Node
- [ ] Version/compat handshake: CLI sends its version, BFF exposes min/max supported (extend `/auth/cli-info`); warn or fail with an upgrade hint
- [ ] Check/document the minimum supported `oxen` version in `mice version`/`login`
- [ ] Token storage in OS keychain (macOS Keychain, libsecret, Windows Credential Manager) with file fallback; note oxen's own config still stores the token in plaintext
- [ ] Credential-file location unification / `MICE_HOME` vs `MICE_CONFIG_DIR` cleanup

### Phase 6 — Missing surfaces (proposed, not approved)

- [ ] `mice workspace` completion of W6 (see [08-workspaces.md](./08-workspaces.md) and EPICS PLAT-WS "W6"); group exists but needs e2e and docs
- [ ] `mice notifications` e2e/docs ([14-notifications.md](./14-notifications.md)); streaming/`--watch` unread count
- [ ] `mice session` attach/log streaming (today `connect` returns BFF output only) — [10-sessions.md](./10-sessions.md)
- [ ] `mice stage` (no such command exists; revisit only if a stage entity is planned in [09-jobs.md](./09-jobs.md))
- [ ] `mice job logs --follow`, cluster-job submit (jobs today are local Docker only)
- [ ] Data-transfer helpers (resumable large upload/download) — [06-data-transfer.md](./06-data-transfer.md)

## 8. Related plans

| Topic | Plan |
| --- | --- |
| Device flow, PATs, session lifecycle | [01-authentication.md](./01-authentication.md) |
| Permissions enforced for CLI calls | [02-authorization.md](./02-authorization.md) |
| `audit` commands, `via: pat` attribution | [03-audit.md](./03-audit.md) |
| Repositories, namespaces | [05-repositories.md](./05-repositories.md) |
| Large file transfer | [06-data-transfer.md](./06-data-transfer.md) |
| `workspace` | [08-workspaces.md](./08-workspaces.md) |
| `job` | [09-jobs.md](./09-jobs.md) |
| `session` | [10-sessions.md](./10-sessions.md) |
| `lineage` | [11-lineage.md](./11-lineage.md) |
| `meta` | [12-metadata-search.md](./12-metadata-search.md) |
| `favorite` | [13-favorites.md](./13-favorites.md) |
| `notifications`, `announcement` | [14-notifications.md](./14-notifications.md) |

## 9. Test cases

Existing IDs are shared with the e2e specs; `TC-CLI-16+` are proposed.

| ID | Case | Status |
| --- | --- | --- |
| TC-CLI-01…07 | PAT on `/api`, author injection, revoked PAT, Profile token UI, Clone box, `/auth/cli-info`, device login API | Shipped (`e2e/tests/cli-auth.spec.ts`) |
| TC-CLI-08…15 | Device page redirect/deny/401s, whoami/logout need Bearer, poll pending→approved, Profile docs, unknown code | Shipped (`e2e/tests/cli-device-ui.spec.ts`) |
| TC-CLI-16 | Every command in `usage()` is dispatched; unknown command exits non-zero | Proposed |
| TC-CLI-17 | `MICE_REMOTE` vs `--remote` precedence is documented and tested | Proposed |
| TC-CLI-18 | `mice login` against a stub BFF: pending → slow_down → approved writes `0600` credentials | Proposed |
| TC-CLI-19 | Non-TTY destructive command without `--yes` exits `1` without calling the API | Proposed |
| TC-CLI-20 | Scoped PAT gets a clear error from admin groups | Proposed |
| TC-CLI-21 | Completion output lists exactly the registered commands | Proposed (needs registry) |

## 10. Open questions

1. Is `MICE_VERSION` meant to track the root package version, or a separate CLI release train?
2. Should `--remote` outrank `MICE_REMOTE` (conventional), or is env-first intentional for CI?
3. Should credentials move to the keychain, given that `oxen config --auth` stores the token in plaintext anyway?
4. Is the CLI to stay Node-only (needs Node + `oxen` + Docker for jobs), or is a binary release required for scientists' machines?
5. When the BFF API changes, how long must older CLIs keep working (compat window)?
6. Should help go to stdout when explicitly requested (`--help`, exit `0`)? Today it always goes to stderr.

## 11. Risks

| Risk | Mitigation |
| --- | --- |
| Help text and dispatch drift (hand-written `usage()`, 1k-line `main`) | Registry + generated help (Phase 4); TC-CLI-16 |
| Plaintext PAT on disk (CLI file and oxen config) | `0600` today; keychain proposal; short PAT expiry ([01-authentication.md](./01-authentication.md)) |
| CLI/BFF version skew with no handshake | Compat check (Phase 5) |
| `mice.mjs` and `login.mjs` untested at unit level | Registry refactor makes dispatch testable; stub-BFF tests |
| Doc drift (`MICE_HOME` vs `~/.config/mice`, stale `mice-job` mentions, fixed) | Fix with the next docs pass |
| Destructive `job reset` restores the worktree | Confirmation, fail-closed without TTY |
