# OPERATIONS — PLAT-OPS implementation plan

Living design and phased plan for epic `PLAT-OPS` ("Deployment, state & operations"): how Mice is built, deployed, persisted, backed up, observed and upgraded. This epic has **no entry in [EPICS.md](./EPICS.md) yet** (proposed, not approved); it documents platform concerns that already exist in code/config but had no plan.

Related: [EPICS.md](./EPICS.md) · [01-authentication.md](./01-authentication.md) · [02-authorization.md](./02-authorization.md) · [03-audit.md](./03-audit.md) · [04-gxp-compliance.md](./04-gxp-compliance.md) · [08-workspaces.md](./08-workspaces.md) · [09-jobs.md](./09-jobs.md) · [10-sessions.md](./10-sessions.md) · [14-notifications.md](./14-notifications.md) · [15-administration.md](./15-administration.md) · [ADR 0001](../docs/adr/0001-bff-identity-trust-model.md) · [README.md](../README.md)

## 1. Purpose & scope

**In scope**

- Shipped deployment topology (Compose), build artefacts, env/config surface, production start gate
- Persistence: every file under `AUTH_DATA_DIR` (and jobs/sessions/workspace dirs), atomicity and concurrency guarantees
- Health, logging, test/CI tooling, privileged host access (Docker socket, bind mounts)
- Gaps: backup/restore, state versioning, DB swap, HA, observability, secrets, runbooks, CI/CD, Kubernetes, proxy trust, rate limiting

**Out of scope**

- Regulatory requirements for backup integrity (GXP-R-061/063) — owned by [04-gxp-compliance.md](./04-gxp-compliance.md); this plan supplies the mechanism
- Audit event schema — [03-audit.md](./03-audit.md); AuthN/Z design — [01](./01-authentication.md) / [02](./02-authorization.md)
- Admin UI surfaces — [15-administration.md](./15-administration.md)

## 2. Current state

Everything below was checked against the repo at time of writing (see §10 for what was not).

### 2.1 Topology and build

| Piece | Behaviour | Source |
| --- | --- | --- |
| Compose stack | `oxen-server`, `keycloak` (`start-dev --import-realm`), `auth`, `guacd`, `web`, optional `rustguac` (profile) on network `mice` | [`compose.yaml`](../compose.yaml) |
| Auth image | Only a `dev` target: `node:22-alpine`, copies docker CLI + prebuilt Go helpers `mice-readwatch`/`mice-xattr`, runs `npm install` then `npm run dev` (`tsx watch`) at **container start**; source is bind-mounted (`./auth:/app`) | [`auth/Dockerfile`](../auth/Dockerfile) |
| Web image | `dev` (Vite) and `production` (build → `nginx:alpine`) targets; **no nginx config file** in `web/` (default config only: no `/api`/`/auth` proxy, no SPA fallback, no headers) | [`web/Dockerfile`](../web/Dockerfile) |
| Compose uses | `target: dev` for both `auth` and `web`; the `production` web target is not referenced by Compose | `compose.yaml` |
| Helpers | `make readwatch` cross-compiles Go binaries to `auth/bin/linux-{amd64,arm64}`; `make up` builds them if missing | [`Makefile`](../Makefile), `auth/cmd/` |
| Keycloak | Realm import from [`auth/keycloak/realm-mice.json`](../auth/keycloak/realm-mice.json); dev mode, `admin/admin`, no persistent volume for Keycloak DB | `compose.yaml` |
| Oxen data | Named volume `oxen-data`; `oxen/oxen-server:latest` (unpinned); port `3001` published for e2e (README "Production" tells operators to drop it via `compose.prod.yaml` with `ports: !reset []`) | `compose.yaml`, README |
| Make targets | `up`, `down`, `reset` (wipes `mice_oxen-data`, `mice_auth_data`, store/workspace volumes, `.data/jobs`), `clean`, `install`, `test*`, `smoke`, `readwatch` | `Makefile` |

### 2.2 Configuration and production gate

| Piece | Behaviour | Source |
| --- | --- | --- |
| Env surface | Single `loadEnv(process.env)` → `env` object; ~70 vars covering OIDC, session, jobs, sessions, AuthZ, notifications (SMTP/VAPID), directory, public origins. Defaults are dev-friendly (e.g. `AUTH_DATA_DIR=./data`, `JOBS_RUNNER=docker`) | [`auth/src/env.ts`](../auth/src/env.ts), [`.env.example`](../.env.example) |
| Production gate | `NODE_ENV=production` → refuses to start with missing/dev `SESSION_SECRET`, shipped `OIDC_CLIENT_SECRET`, or `COOKIE_SECURE!=true`. Covers only these three | [`auth/src/startupGate.ts`](../auth/src/startupGate.ts) |
| Compose defaults | Dev secrets baked in as `${VAR:-default}`; `NODE_TLS_REJECT_UNAUTHORIZED=0` default; `AUTHZ_DEV_GRANT_ALL=true`; `COOKIE_SECURE=false`; `NODE_ENV` is **not** set by Compose | `compose.yaml` |
| Secrets | Plain env vars only (`SESSION_SECRET`, `OIDC_CLIENT_SECRET`, `NOTIFICATIONS_SMTP_URL`, `NOTIFICATIONS_VAPID_PRIVATE_KEY`, `SESSIONS_RUSTGUAC_API_KEY`, `SESSIONS_GUAC_CRYPT_KEY`); no `_FILE` variants or secret-manager integration found | `env.ts` |

### 2.3 State stores (single instance, local disk)

All paths are relative to `AUTH_DATA_DIR` (Compose: volume `auth_data` at `/data`) unless noted. Shared helper: [`auth/src/jsonStore.ts`](../auth/src/jsonStore.ts) — `readJsonFile` (returns the **fallback on any read/parse error**, silently) and `writeJsonFile` (write `path.<pid>.tmp` then `renameSync`; **no fsync**, no lock, no version check).

| File | Owner module | Write pattern |
| --- | --- | --- |
| `audit.jsonl` | `audit.ts` (also read by `notificationsStore.ts`) | `appendFileSync` one hash-chained JSON line per event (append-only; no rewrite path) |
| `pats.json` | `tokens.ts` (`{version:1, tokens}`) | tmp + rename (own implementation; invalid shape → empty store) |
| `session-revocations.json` | `credentialRevocation.ts` | `writeJsonFile` |
| `cli-devices.json` | `cliDevice.ts` | store-local (not verified) |
| `instance-admins.json`, `namespaces.json`, `namespace-members.json`, `repo-collaborators.json` | `authzRepository.ts` (owns the documents) with `authzInstanceStore.ts`, `authzNamespaceStore.ts`, `authzMembershipStore.ts`, `authzCollaboratorStore.ts` | `writeJsonFile` read-modify-write; one-off `identityMigration.ts` rewrites them |
| `custom-roles.json` | `customRoles.ts` | not verified |
| `access-requests.json` | `accessRequests.ts` (`{version:1, requests}`) | `writeJsonFile` |
| `announcements.json` | `announcementsStore.ts` | `writeJsonFile` |
| `favorites.json` | `favoritesStore.ts` | `writeJsonFile`; purged on audit events |
| `notifications.json` | `notificationsStore.ts` | staging file (`wx`, 0600) + fsync + rename — the strongest pattern in the codebase |
| `meta.json`, `meta-history.jsonl` | `metaStore.ts` | `writeJsonFile` (snapshot, with in-place migration on read); history appended |
| `lineage.jsonl` | `lineage.ts` | append (rebuildable from oxen; see index.ts rebuild) |
| `jobs/jobs.jsonl`, `jobs/job-aliases.json`, job logs/workdirs | `jobsStore.ts`, `jobs.ts`, `jobsRunner.ts` | `upsertJob` **rewrites the whole file with `writeFileSync` (not atomic, no tmp/rename)**; alias file likewise |
| `sessions/sessions.jsonl` (`SESSIONS_DATA_DIR`) | `sessionsStore.ts` | append on create; rewrite via tmp + rename |
| `/data/store`, `/data/workspaces` (volumes `mice-store`, `mice-workspaces`) | `auth/src/workspaces/` (`checkout.ts` keeps a journal) | checkout store + overlay upper/work dirs; **not JSON** |
| `oxen-data` volume | oxen-server | Oxen repositories — the system of record for versioned data |

**Concurrency model.** There are no file locks or cross-process coordination. Safety relies on Node's single-threaded, synchronous `*Sync` calls inside **one** auth process. Two auth replicas (or a `tsx watch` restart overlap) sharing a volume would lose updates (read-modify-write) and interleave job rewrites. In-memory state is also process-local: the job queue (`const queue` in `jobs.ts`, rebuilt from `jobs.jsonl` by `resumeQueuedJobs()`), session lifecycle sweepers/lease renewer, notification worker. [`.env.example`](../.env.example) already states "Notifications: one auth process only".

**Versioning.** Only `pats.json` and `access-requests.json` carry `version: 1`. `metaStore.ts` migrates on read; `identityMigration.ts` is a one-shot identity rewrite. There is no global schema version, migration runner, or downgrade guard.

### 2.4 Health, logging, observability

| Piece | Behaviour |
| --- | --- |
| Liveness | `GET /healthz` → `{ok:true}` ([`auth/src/app.ts`](../auth/src/app.ts)); static — does not check data dir, oxen upstream, or IdP. Readiness: `GET /readyz` → `{ok, audit}`, 200 or 503; covers the audit store (last write succeeded, readable) and chain state (result of the last verification at boot or on the `AUDIT_VERIFY_INTERVAL_SEC` schedule, default 3600; `chain` is `ok`, `broken` with the first break, or `unverified`). It does not check oxen upstream or the IdP. No Compose `healthcheck:` on any service (Keycloak sets `KC_HEALTH_ENABLED` but it is unused) |
| Logging | `console.log`/`console.error` with `[mice-auth]` prefix; one startup line; unstructured, no request IDs, no levels, no access log |
| Metrics / tracing | None found (no `/metrics`, no OpenTelemetry) |
| Audit | Business audit trail is `audit.jsonl` ([03-audit.md](./03-audit.md)) — not an operational log |

### 2.5 Privileged host access

- Auth container mounts the **host Docker socket** (`JOBS_DOCKER_SOCKET_HOST` → `/var/run/docker.sock`) and ships the docker CLI; used by the local jobs runner and the sessions Docker provisioner. Socket access is effectively host root.
- Bind mounts `JOBS_HOST_DATA_DIR` / `SESSIONS_HOST_DATA_DIR` (default `./.data/*`) must be **host-visible absolute paths** so `docker run -v` from the auth container resolves; `make up` exports them. `JOBS_IMAGE_PULL_ALLOWLIST` constrains images.
- `JOBS_RUNNER=kubernetes` is supported by env (`JOBS_K8S_NAMESPACE`, `JOBS_KUBECTL_BIN`); there are **no manifests** in the repo. See [09-jobs.md](./09-jobs.md), [10-sessions.md](./10-sessions.md), [08-workspaces.md](./08-workspaces.md).

### 2.6 Testing and CI

| Piece | Behaviour |
| --- | --- |
| Unit | `npm run test:unit` = auth (`auth/package.json` → `scripts/test-fail-fast.mjs --tsx --dir src`), CLI (`--dir cli/lib`), web; harness runs `node:test` files sequentially and stops at first failing file ([`scripts/test-fail-fast.mjs`](../scripts/test-fail-fast.mjs)) |
| Typecheck | `npm run typecheck` in `auth/` (`tsc --noEmit`) |
| E2E | Playwright ([`e2e/playwright.config.ts`](../e2e/playwright.config.ts)): chromium, `workers: 1`, `maxFailures: 1`, `retries` 1 only if `CI`; targets a **running** stack (`MICE_BASE_URL` default `http://localhost:5173`, `OXEN_URL` `:3001`); no `webServer` block — `make up` first. `make test-sessions` forces `SESSIONS_PROVISIONER=mock` |
| Case catalog | README points at [`e2e/tests/`](../e2e/tests/) (no separate `TESTS.md`); deny paths live in `deny-paths.spec.ts` |
| CI | [`.github/workflows/auth-tests.yml`](../.github/workflows/auth-tests.yml): auth typecheck + unit, web typecheck + unit, CLI unit; `e2e-deny-paths` runs only where the Compose stack is available (`vars.MICE_E2E_STACK`). No image build/publish, no lockfile/audit/SBOM checks |

## 3. Goals & non-goals

**Goals (proposed, not approved):** a documented, repeatable single-instance production deployment; verified backup/restore; safe upgrades with rollback; basic observability; CI that runs unit + typecheck + e2e.

**Non-goals (for now):** multi-region, autoscaling, replacing oxen-server storage, a managed-service offering.

## 4. Phased checklist

### Phase 0 — shipped baseline (verified)

- [x] Compose stack with named volumes for oxen and auth data ([`compose.yaml`](../compose.yaml))
- [x] Production start gate for secrets/cookie flag ([`startupGate.ts`](../auth/src/startupGate.ts), `startupGate.test.ts`)
- [x] Atomic tmp+rename JSON writes for most small stores ([`jsonStore.ts`](../auth/src/jsonStore.ts))
- [x] `/healthz` liveness endpoint
- [x] `/readyz` readiness endpoint for the audit store and chain (no Compose `healthcheck:` wired yet)
- [x] README production note: do not publish raw oxen port
- [x] Queue recovery after restart (`resumeQueuedJobs`, `resumeInterruptedProvisions`)
- [x] Fail-fast unit harness and Playwright e2e against a live stack

### Phase 1 — documentation and hygiene (proposed, not approved)

- [x] Remove the dead `TESTS.md` README link (README points at `e2e/tests/`)
- [ ] Operator guide: env var reference grouped by concern, production checklist (`NODE_ENV=production`, `COOKIE_SECURE`, `AUTHZ_DEV_GRANT_ALL=false`, `NODE_TLS_REJECT_UNAUTHORIZED` unset, pinned `oxen-server` tag, Keycloak not in `start-dev`)
- [ ] Extend production gate: reject `AUTHZ_DEV_GRANT_ALL=true`, `NODE_TLS_REJECT_UNAUTHORIZED=0`, default Keycloak admin
- [ ] Fix non-atomic `upsertJob`/`rekeyJob`/alias writes in `jobsStore.ts` (reuse tmp+rename); decide fsync policy for `writeJsonFile`
- [ ] Surface corrupt-file reads: `readJsonFile` returning the fallback on parse error can silently reset authz/PATs on the next write

### Phase 2 — backup, restore, integrity (proposed, not approved)

- [ ] Supported backup method for `auth_data` + `oxen-data` (+ `mice-store`/`mice-workspaces` as rebuildable?) — quiesce vs snapshot consistency across files
- [ ] `backup`/`restore` script or admin endpoint producing an archive + manifest (file hashes, counts, generator version)
- [ ] Restore verification: audit sequence/hash check, JSON parse of every store — feeds GXP-R-063 in [04-gxp-compliance.md](./04-gxp-compliance.md)
- [ ] Retention/rotation for append-only files (`audit.jsonl`, `lineage.jsonl`, `meta-history.jsonl`) — interacts with `SESSIONS_AUDIT_RETENTION_DAYS` and [03-audit.md](./03-audit.md)

### Phase 3 — state versioning and storage seam (proposed, not approved)

- [ ] Global state schema version file + startup migration runner with refuse-to-start on newer-than-known
- [ ] **"JSON state store" deep-module candidate:** today each module (`authzStoreFiles`, `favoritesStore`, `metaStore`, `accessRequests`, `announcementsStore`, `jobsStore`, `sessionsStore`, `notificationsStore`, `tokens`, `credentialRevocation`) re-implements path, read, shape validation and write. A single store interface (get/put/append/transaction, versioned, atomic) would give one seam for locking, migration, backup and a future SQLite/Postgres adapter
- [ ] Spike SQLite (single node, transactional, easy backup) vs Postgres (HA); decision recorded as an ADR in `docs/adr/`

### Phase 4 — observability (proposed, not approved)

- [ ] `/readyz` checking data-dir writability, oxen upstream, OIDC discovery; Compose/K8s healthchecks
- [ ] Structured JSON logging with levels and request IDs; documented retention/shipping
- [ ] `/metrics` (request rates, job queue depth, session counts, store write errors)

### Phase 5 — build, CI, release (proposed, not approved)

- [ ] Production `auth` image target (no `npm install` at start, no docker CLI unless runner needs it, non-root, pinned base, `tsc` build)
- [ ] nginx config for `web` production target (SPA fallback, proxy `/api`+`/auth`, security headers) or documented ingress alternative
- [ ] GitHub Actions: `npm ci`, `typecheck`, `test:unit`, e2e with Compose (`SESSIONS_PROVISIONER=mock`), image build + publish, dependency audit
- [ ] Pin `oxen-server`, `keycloak`, `guacd` images; compatibility matrix

### Phase 6 — runtime hardening and HA (proposed, not approved)

- [ ] Reverse proxy/TLS guide; define trusted forwarded headers (only `csrf.ts` references `X-Forwarded-*` today; cookie `Secure` is a manual flag)
- [ ] Rate limiting / brute-force protection (none found in `auth/src`; relevant to login, device-code, PAT endpoints)
- [ ] Secrets: `*_FILE` env support or secret-store integration; rotation procedure for `SESSION_SECRET` (invalidates sessions) and PATs
- [ ] Docker-socket mitigation: socket proxy / rootless runner / Kubernetes-only mode
- [ ] Multi-instance/HA: needs Phase 3 DB, shared queue/lease for jobs and session sweepers, sticky or shared WebSocket state for Guacamole gateway
- [ ] Kubernetes manifests / Helm chart (auth, web, oxen PVC, jobs namespace + RBAC for `JOBS_RUNNER=kubernetes`)
- [ ] Upgrade and rollback runbooks (backup → migrate → smoke → rollback by restore)

## 5. Test cases

| ID | Case | Phase |
| --- | --- | --- |
| TC-OPS-01 | `NODE_ENV=production` with dev `SESSION_SECRET` / shipped client secret / `COOKIE_SECURE!=true` → process exits (exists as unit tests) | 0 |
| TC-OPS-02 | Production gate rejects `AUTHZ_DEV_GRANT_ALL=true` and `NODE_TLS_REJECT_UNAUTHORIZED=0` | 1 |
| TC-OPS-03 | `upsertJob` interrupted mid-write leaves previous `jobs.jsonl` intact | 1 |
| TC-OPS-04 | Corrupt `pats.json`/`namespaces.json` is reported, not silently replaced | 1 |
| TC-OPS-05 | Backup of a live stack restores to an identical state; manifest hashes verify | 2 |
| TC-OPS-06 | Tampered/truncated `audit.jsonl` fails restore verification | 2 |
| TC-OPS-07 | Startup refuses newer-than-known state version; older state migrates once | 3 |
| TC-OPS-08 | Store adapter contract suite passes for JSON and DB backends | 3 |
| TC-OPS-09 | `/readyz` fails when data dir is read-only or oxen is down | 4 |
| TC-OPS-10 | Every request log line is valid JSON with request ID | 4 |
| TC-OPS-11 | CI on a clean checkout runs typecheck, unit and e2e green | 5 |
| TC-OPS-12 | Repeated failed logins/device-code attempts are throttled | 6 |
| TC-OPS-13 | Two auth replicas on one volume are refused (or safely coordinated) | 6 |

## 6. Open questions

1. Target deployment: single Docker host, Kubernetes, or both? This decides whether the Docker-socket runners stay supported in production.
2. Is SQLite sufficient (single instance + backup) or is Postgres/HA a requirement?
3. Who owns backup cadence and restore attestation for GxP deployments ([04-gxp-compliance.md](./04-gxp-compliance.md))?
4. Should `mice-store`/`mice-workspaces` be backed up or treated as rebuildable from oxen?
5. Should `lineage.jsonl` be treated as derived (rebuildable) data and excluded from integrity guarantees?
6. Keep Keycloak in the production stack or require an external IdP ([01-authentication.md](./01-authentication.md))?

## 7. Risks

| Risk | Mitigation |
| --- | --- |
| Silent state reset when a JSON file fails to parse | Phase 1 corrupt-read handling; backups |
| Lost updates if two auth processes share `auth_data` | Document single-instance; Phase 6 guard |
| Non-atomic job store rewrite corrupts `jobs.jsonl` on crash | Phase 1 fix |
| Docker socket = host root for anyone who compromises auth | Phase 6 socket proxy / K8s runner; [ADR 0001](../docs/adr/0001-bff-identity-trust-model.md) trust model |
| Dev defaults (`AUTHZ_DEV_GRANT_ALL`, TLS-verify off, `admin/admin`) leak into production | Extended start gate; operator checklist |
| Dev-mode images (`npm install` at start, Keycloak `start-dev`) used in production | Phase 5 images |
| Unpinned `oxen-server:latest` changes API under Mice | Pin tags |
| Unbounded growth of append-only logs | Retention/rotation (Phase 2) |

## 8. Cross-plan dependencies

| Plan | Interaction |
| --- | --- |
| [03-audit.md](./03-audit.md), [04-gxp-compliance.md](./04-gxp-compliance.md) | Backup integrity, retention, WORM; this plan provides the mechanism |
| [01-authentication.md](./01-authentication.md), [02-authorization.md](./02-authorization.md) | Secrets, production gate, authz/PAT stores as backup scope |
| [08-workspaces.md](./08-workspaces.md), [09-jobs.md](./09-jobs.md), [10-sessions.md](./10-sessions.md) | Docker socket, host bind mounts, K8s runner, queue/lease HA |
| [14-notifications.md](./14-notifications.md) | "One auth process only" constraint; SMTP/VAPID secrets |
| [15-administration.md](./15-administration.md) | Admin-facing backup/health UI, if any |

## 9. Suggested order

Phase 1 (cheap, removes silent-failure risks) → Phase 5 CI (protects everything after) → Phase 2 → Phase 3 → Phase 4 → Phase 6.

## 10. Verification notes

Not verified: write patterns of `cliDevice.ts` and `customRoles.ts`; workspace store/journal internals and `lineage.jsonl` write mode; whether `SESSIONS_GUAC_CRYPT_KEY` is the only guac secret; exact count of env vars (~70 is approximate); whether the sessions store appends and rewrites as summarised; web production image behaviour (nginx defaults assumed from absence of config).
