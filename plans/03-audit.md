# AUDIT — PLAT-AUDIT implementation plan

Living design and phased plan for epic [`PLAT-AUDIT`](./EPICS.md#plat-audit--gxp-oriented-change-audit): append-only, attributable audit of mutations through the auth BFF.

Related: [EPICS.md](./EPICS.md) · [01-authentication.md](./01-authentication.md) · [02-authorization.md](./02-authorization.md) · [04-gxp-compliance.md](./04-gxp-compliance.md) · [README.md](../README.md)

## 1. Purpose & scope

**In scope**

- Emit audit events for non-GET/HEAD requests proxied by the auth BFF
- Append-only, hash-chained JSONL store under `AUTH_DATA_DIR` ([`GXP slice 1–2`](../.scratch/auth-audit-gxp/spec.md))
- Query API + Audit UI (filter by actor, repo, time, action)
- Attribution from BFF-resolved identity (`sub` / `iss` / email / name) and auth `via`

**Out of scope (this document)**

- Required GxP reason / change-control id before mutate (Phase 2)
- Retention policies and formal export packaging (Phase 2)
- Auditing raw oxen-server `:3001` (e2e helpers only)
- Separate audit microservice; Mongo/Postgres store (future swap)

**Depends on:** [`PLAT-AUTH`](./01-authentication.md) — session / PAT identity at the BFF.

**AuthZ for query:** [`02-authorization.md`](./02-authorization.md) — instance admin or instance permission `view_audit` for instance-wide `GET /auth/audit`; namespace **Owners** (and custom ns roles with `view_audit`) may query events **scoped to their namespace** only via `authorizeAuditQuery`.

## 2. Current state

| Piece | Behavior |
| --- | --- |
| Auth BFF | Proxies `/api/*` with author injection ([`../auth/src/proxy.ts`](../auth/src/proxy.ts)) |
| Identity | Session cookie or `mice_pat_*` ([`../auth/src/requireAuth.ts`](../auth/src/requireAuth.ts)) |
| PAT store | `AUTH_DATA_DIR/pats.json` |
| Audit | Append-only JSONL (`../auth/src/audit.ts`); query UI at `/audit`; AuthZ gates on `GET /auth/audit` |

## 3. Goals & non-goals

### Goals

1. Intercept write paths that mutate oxen-server state (via BFF)
2. Immutable, append-only audit store with attributable actor identity
3. Audit query UI (filter by actor, repo, time, change type)
4. Reuse existing commit/message/description fields as narrative (no required GxP reason gate)

### Non-goals (MVP)

- Blocking writes without a GxP reason
- WORM media, signed checkpoints (slice 5 of the GxP spec; hash-chaining is done)
- Multi-instance shared audit without a later store swap

## 4. Target architecture

### Decisions

| Topic | Choice |
| --- | --- |
| Scope | Capture + query first; message/description from mutation bodies when present |
| Store | Append-only **JSONL** at `AUTH_DATA_DIR/audit.jsonl`, hash-chained (`auditChain.ts`) over an append-only log seam with no rewrite path |
| Emitter | Auth BFF `proxyToOxen`: **intent** event before forwarding, **outcome** event (with `status`) after; native mutations via `guarded({ mutates: true })` / `auditMutation` |
| Reads | Never audited |
| Attribution | Plumb `via` (`session` \| `pat`) with `SessionUser` |

```mermaid
flowchart LR
  UI[Mice UI] -->|session cookie| BFF[auth BFF]
  CLI[Oxen CLI] -->|PAT Bearer| BFF
  BFF -->|mutate| Oxen[oxen-server]
  BFF -->|append event| JSONL["AUTH_DATA_DIR/audit.jsonl"]
  UI -->|GET /auth/audit| BFF
```

### Components

| Component | Role |
| --- | --- |
| [`../auth/src/audit.ts`](../auth/src/audit.ts) | Append + query JSONL |
| [`../auth/src/proxy.ts`](../auth/src/proxy.ts) | Classify action; extract ns/repo/message; append after upstream |
| `GET /auth/audit` | Filtered query for UI / automation |
| `/audit` UI | Platform audit table + filters |

## 5. Event schema

One JSON object per line:

| Field | Notes |
| --- | --- |
| `id` | Random hex id |
| `prev_hash` / `hash` | SHA-256 chain links. `hash` covers the canonical JSON of the event without `hash`; the genesis event has `prev_hash` of 64 zeros |
| `phase` | `intent` \| `outcome` \| `genesis`; absent on single events (jobs, sessions, login, …) |
| `intent_id` | On an outcome: the id of its intent event |
| `ts` | ISO-8601 |
| `actor` | `{ sub, iss, email, name }` |
| `via` | `session` \| `pat` (`system` on the genesis event) |
| `method` | HTTP method |
| `path` | Request pathname (`/api/...`) |
| `status` | Upstream HTTP status; `0` on an intent event (not yet known) |
| `action` | Coarse class (`repo.create`, `file.write`, `file.delete`, `branch.*`, `merge`, `workspace.create/delete/commit/merge/file.write/file.delete/other`, `other`). New names keep the `file.`/`workspace` prefixes that AuthZ maps on |
| `namespace` / `repo` | Parsed from `/api/repos/:ns/:repo/...` when possible |
| `dataset` | *(proposed)* Dataset version the mutation acted on: oxen commit id / content hash before and after (`{ base, head }`), when determinable; see Open question 2 |
| `reason` / `change_control_id` | *(proposed, [04-gxp-compliance.md](./04-gxp-compliance.md) Phase 2)* Structured fields, not free text in `message`/`detail`; absent when policy does not require them |
| `message` | From body `message` / `commit_message` when present |
| `detail` | Small non-secret extras (e.g. branch, file path); never tokens or file bytes |

Never log `Authorization`, cookies, or request body blobs.

## 5.1 BFF-native mutation actions

Mutations handled directly by the auth BFF (not proxied to oxen) emit events via `auditMutation` in [`auth/src/auditMutation.ts`](../auth/src/auditMutation.ts), injected into the route modules by `createApp` in `auth/src/app.ts` (jobs and sessions emit from their own modules). Denied/failed attempts are recorded where they reveal privilege changes (`status` 400/403).

| Area | Actions |
| --- | --- |
| Auth | `auth.login`, `auth.logout` |
| Tokens / CLI | `token.create`, `token.revoke`, `device.approve`, `device.deny`, `device.redeem` |
| Instance | `instance.settings.update`, `instance.admin.add/remove`, `instance.permissions.update`, `announcement.create/update/delete` |
| Access / training | `access-request.submit/approve/deny`, `training.update` |
| Namespaces | `namespace.create`, `namespace.settings.update`, `namespace.delete`, `namespace.member.set/remove` (and `repo.delete` per cascaded repo) |
| Repo access | `repo.collaborator.set/remove` |
| Custom roles | `custom-role.namespace.create/update/delete`, `custom-role.repo.create/update/delete` |
| Lineage | `lineage.rebuild` |
| Jobs / Sessions | `job.*`, `session.create/connect/stop/retry/destroy/disconnect/sync` |

Token secrets are never written to `detail`.

## 5.2 Chain, intent and outcome (GxP slices 1–2)

- **Chain.** `appendAudit`, `appendIntent` and `appendOutcome` go through one writer: read the tail hash and append in one synchronous critical section (re-entry throws); the data-directory lock keeps other processes out. The first append writes a `audit.genesis` event. The file is never rewritten; `AppendOnlyLog` has no `rewrite`/`appendRaw`.
- **Verification.** `verifyAudit()` walks the file (unparseable lines count as breaks, they are not skipped) and reports the first break: index, event id, reason. It runs at boot (`initAudit()`) and every `AUDIT_VERIFY_INTERVAL_SEC` (default 3600) via the `Clock` seam. Result is exposed in `/readyz`. Known limit: dropping the *latest* events is not detectable until signed checkpoints (slice 5).
- **Boot.** A non-empty `audit.jsonl` whose first row has no hashes makes boot throw (`not hash-chained`); the file is not touched. An empty file gets a genesis event. A *broken* chain does not stop boot; it fails `/readyz` and logs (blocking mutations is slice 5).
- **Intent first.** Proxied non-GET/HEAD requests: intent (same `action` as the outcome, `status: 0`) → upstream → outcome. Native routes marked `mutates: true` in `guarded` (namespaces, members, collaborators, custom roles, instance settings/admins/permissions, tokens, device approve, service principals, metadata writes, access-request decisions, training, lineage rebuild) get a `bff.mutation` intent; every `audit(...)` call becomes an outcome with the real action; a handler that audits nothing gets a `bff.mutation` outcome with the response status. If the intent cannot be written the BFF answers **503** (`audit_unavailable`) and nothing reaches oxen or the handler. An outcome that cannot be written is logged and flips readiness to failing; the mutation already happened.
- **Readiness.** `GET /readyz` → 200/503 with `{ ok, audit: { store, chain, events, verifiedAt, firstBreak? } }`. `store` is `error` after a failed append until the next success. `/healthz` stays static.
- **Listing.** `GET /auth/audit` and CSV show one row per mutation: genesis and intents that have an outcome are hidden; an intent **without** an outcome stays visible (possible crash mid-request). `?include=chain` shows every event. CSV gains `event_id`, `intent_id`, `phase` columns, and an intent row has an empty `status`. Other single events (jobs, sessions, bypass, login) are unchanged and unpaired.
- **Not yet intent-first:** jobs, sessions, workspace routes, offboarding and the other direct `appendAudit` callers stay single best-effort events.

## 6. Configuration

| Variable | Purpose |
| --- | --- |
| `AUTH_DATA_DIR` | Directory for `audit.jsonl` (and `pats.json`) |
| `AUDIT_VERIFY_INTERVAL_SEC` | Chain re-verification interval, default 3600 |

Same Compose `auth_data` volume as PATs.

## 7. Phased delivery

### Phase 0 — Emit (Hono) — **this delivery**

- [x] `audit.ts` JSONL append + query helpers
- [x] Proxy hooks + `via` plumbing; action/ns/repo/message extraction
- [x] `GET /auth/audit`
- [x] E2E: mutate via BFF → event with correct `actor.sub`

### Phase 1 — Query UI + tests — **this delivery**

- [x] Audit page + Layout nav
- [x] Playwright `e2e/tests/audit.spec.ts` (TC-AUDIT-01…06)
- [x] Docs: this file, EPICS Partial, README pointer

### Phase 1.5 — AuthZ gates on query (depends on PLAT-AUTHO)

- [x] Enforce [02-authorization.md](./02-authorization.md) D9 on `GET /auth/audit` and `/audit` UI
- [x] Instance-wide: instance admin or `view_audit`
- [x] Namespace Owners / ns `view_audit` capability: results limited to allowed namespaces
- [ ] Playwright: insufficient principal → `403`; Owner cannot read other namespaces (if not already covered in authz e2e)

### Phase 2 — GxP extras

Umbrella checklist and sequencing live in [`04-gxp-compliance.md`](./04-gxp-compliance.md) (Phases 1–4). This epic keeps audit-store detail:

- Reason / change-control id on audit events — [04-gxp-compliance.md](./04-gxp-compliance.md) Phase 2 (`GXP-R-040`…`042`)
- Fail-closed append when `GXP_STRICT=true` — [04-gxp-compliance.md](./04-gxp-compliance.md) Phase 1 (`GXP-R-025`)
- Retention / export (filtered NDJSON + manifest) — [04-gxp-compliance.md](./04-gxp-compliance.md) Phase 4
- Store swap (Postgres JSONB / Mongo) behind the same schema (optional, with export)

### Phase 2.1 — Durability & schema (proposed, unchecked)

- [x] Persist intent before proxying and write an outcome after (orphan intents stay visible; no automatic reconciliation yet) (needed for [04-gxp-compliance.md](./04-gxp-compliance.md) `GXP_STRICT`, `GXP-R-025`)
- [ ] Schema: explicit dataset version/commit fields (`dataset.base` / `dataset.head`)
- [ ] Schema: structured `reason` and `change_control_id` fields (shared with [04-gxp-compliance.md](./04-gxp-compliance.md) `GXP-R-040`…`042`)
- [ ] Namespace-owner query test coverage: unit + Playwright for Owner scoped to own namespace, other-namespace `403`/empty, ns `view_audit` capability, `403` for insufficient principal (extends the open Phase 1.5 Playwright item)

## 8. API

| Route | Auth | Behavior |
| --- | --- | --- |
| `GET /auth/audit` | Session; **AuthZ per [02-authorization.md](./02-authorization.md)** (`authorizeAuditQuery`: instance admin / `view_audit` / ns-scoped Owner) | Query params: `actor`, `namespace`, `repo`, `action`, `since`, `until`, `limit`, `cursor` |
| (no write routes) | — | Append only from proxy |

Proxied and `mutates` native writes are **fail-closed**: no intent on the chain, no mutation (503). A crash after the intent leaves an intent without an outcome, which lists as such. Other direct `appendAudit` callers remain best-effort.

## 9. UI

| Surface | Change |
| --- | --- |
| Layout nav | **Audit** → `/audit` |
| Audit page | Table + filters; link to repo when ns/repo present |

## 10. Test plan

| Case | Expectation |
| --- | --- |
| TC-AUDIT-01 | Session write via BFF → audit row with actor name/email/sub |
| TC-AUDIT-02 | PAT write → `via: pat` |
| TC-AUDIT-03 | GET `/api/...` → no new audit line |
| TC-AUDIT-04 | `GET /auth/audit` without session → 401 |
| TC-AUDIT-05 | UI `/audit` lists recent event after a mutation |
| TC-AUDIT-06 | Filter by namespace returns only matching rows |

## 11. Open risks

| Risk | Mitigation |
| --- | --- |
| JSONL scan does not scale | Cap `limit`; swap store in Phase 2 behind same API |
| Append failure | Intent failure → 503; outcome failure logged and `/readyz` fails |
| Crash between intent and outcome | Orphan intent visible in lists; no automatic reconciliation |
| Tail truncation / full-file replacement | Not detectable until signed checkpoints (GxP slice 5) |
| Append cost | Each append reads the whole file to find the tail hash (O(n)); revisit with a cached tail or store swap |
| Owner-scoped query leaks | Server-side ns filter; add explicit test coverage (Phase 2.1) |
| Direct `:3001` bypass | Production: do not publish oxen port; product remote is BFF |
| Over-broad `other` actions | Tighten path heuristics as routes are catalogued |

### Open questions

1. **Outbox location:** same JSONL volume (intent records beside `audit.jsonl`) or the future store swap? Does reconciliation record an `unconfirmed` outcome or re-query oxen to infer the result?
2. **Dataset version capture:** is the pre/post commit id available from the oxen response for every mutation class, or does the BFF need an extra read (and lock) before/after proxying?
3. **Reason/change-control placement:** top-level fields vs inside `detail`; ownership split with [04-gxp-compliance.md](./04-gxp-compliance.md) Phase 2.

## 12. How to use this file

1. Implement phases; tick bullets in PRs.
2. Keep decisions in §4 unless an ADR supersedes them.
3. When epic bullets in [EPICS.md](./EPICS.md) land, mark them done.
