# META — PLAT-META implementation plan

Living design and phased plan for a new epic `PLAT-META`: user-defined, **indexable and searchable metadata on every entity** in the system (namespaces, repos, branches, commits, files, workspaces, jobs, sessions, users, …), managed through the auth BFF and surfaced in the web UI.

Related: [EPICS.md](./EPICS.md) · [AUTHO.md](./AUTHO.md) · [AUDIT.md](./AUDIT.md) · [TRACEABILITY.md](./TRACEABILITY.md) · [GXP.md](./GXP.md) · [Jobs.md](./Jobs.md) · [Sessions.md](./Sessions.md)

## 1. Purpose & scope

**In scope**

- One generic metadata model attachable to any entity type via a stable **entity reference**
- **Composable (inherited) metadata**: metadata set on a parent (e.g. a namespace) is inherited by its descendants (repos, branches, files, workspaces, jobs, …) unless explicitly overridden or unset at a lower level (§4.4)
- Typed, validated fields (schema/definition per entity type), plus free-form tags and key/value labels
- A search index over metadata (full-text + facet filters) with AuthZ-aware results
- REST API under the auth BFF, UI to view/edit/search, CLI-friendly (PAT) access
- Every metadata mutation audited ([AUDIT.md](./AUDIT.md)); revision history per entity
- Cross-entity search page ("find everything where `project=ABC` and `status=approved`")

**Out of scope (this document)**

- Replacing oxen-server's native dataframe/column schema metadata (we link to it, not replace it)
- Semantic / vector search (future, behind the same index interface)
- External catalog sync (e.g. DataHub, Purview) — export hooks only
- Storing secrets or PII-sensitive blobs in metadata (explicitly disallowed; validated by size/type)

**Depends on:** [`PLAT-AUTHO`](./AUTHO.md) (permissions), [`PLAT-AUDIT`](./AUDIT.md) (change trail).

## 2. Current state

| Piece | Behavior |
| --- | --- |
| Repo metadata | `repo.metadata` audit/authz action covers PATCH/PUT on repo settings (`auth/src/audit.ts`, `authz.ts`); oxen-server owns it, no search |
| File/tree metadata | oxen-server computed (`/meta/...`: sizes, type counts) — derived, not user-authored |
| Dataframe schema metadata | `setWorkspaceDataFrameSchemaMetadata` / column variant in `web/src/lib/oxen/api.ts`; per-column, per-workspace |
| Jobs / sessions / workspaces / users | Own JSON stores (`jobsStore.ts`, `sessionsStore.ts`, `directory.ts`); no user metadata, only operational fields |
| Search | None cross-entity; only per-page filters (audit filters, jobs list) |
| Storage pattern | Atomic JSON under `AUTH_DATA_DIR` (`jsonStore.ts`), JSONL for audit |

### 2.1 Oxen-server findings (probed live, oxen-server 0.61.1)

| Capability | Result |
| --- | --- |
| `GET /meta/{rev}/{path}` (file/dir) | **Derived only**: hash, size, `data_type`, `mime_type`, `extension`, `latest_commit`, and for tabular files `metadata.tabular` (width, height, schema fields + dtypes). Dirs return aggregate entry data |
| `POST /meta/{rev}/{path}` with `{"metadata":{…}}` | Returns `resource_updated` but the payload is **ignored** (re-read shows nothing). No user-authored file/dir metadata |
| `PUT …/workspaces/{id}/data_frames/schema/{path}` `{"metadata":{…}}` | **Works.** After workspace commit it persists on the schema (`GET /schemas/{rev}` and `/meta` → `tabular.schema.metadata`), versioned with the commit. Free-form JSON object, tabular files only; needs the df indexed in the workspace. Per-column metadata route (`…/columns/schema/metadata/…`) returned 404 in the probe (route/precondition to confirm) |
| `GET /schemas/{rev}` | Lists schemas (path, hash, fields, metadata) for tabular files in a revision — usable as a read source, no query/search |
| `PATCH /api/repos/{ns}/{repo}` | **405** (`allow: GET, DELETE`). Oxen has no repo description/settings update; `repo.metadata` audit/authz mapping in the BFF is therefore forward-looking only |
| Repo/branch/commit/workspace/namespace metadata | None beyond system fields (`repo_uuid`, `size`, `data_types`, commit author/message); no tags/labels/description |
| Search/query across entities | None in the REST API (only per-repo dataframe SQL on indexed frames) |

**Implications for this plan**

- Confirms **D1**: oxen cannot hold user metadata for most entities, so the BFF store is required.
- **Tabular schema metadata is the only native, commit-versioned user metadata.** Treat it as a read-through source in Phase 3 (index `schemas/{rev}` metadata into search) rather than a write target; writes stay via the existing workspace flow.
- **D3 stands**: no oxen API for committing arbitrary metadata; optional `.mice/metadata.json` snapshot (Phase 4) is the only route to commit-versioned metadata for non-tabular files.
- Oxen's derived metadata (`data_type`, `mime_type`, size, tabular width/height/columns) should be **indexed as system fields** (read-only, `source: "oxen"`) so users can search "tabular files with column `age`" without authoring anything. Needs a refresh hook on commit (via BFF proxy or `POST /meta/{rev}` recompute).

**Gap:** no uniform way to label, describe, classify, or find entities; no index.

## 3. Goals & non-goals

### Goals

1. Attach metadata to **any** entity with one API and one UI component
2. Make metadata **searchable** (text + exact/range filters + facets) in < 200 ms at ~100k entities
3. Make metadata **composable**: define once on a namespace/repo, inherit everywhere below, override or remove locally, and always show *where* each value came from
4. Respect AuthZ: a user never sees (or learns of the existence of) metadata for entities they cannot read
5. Metadata changes are attributable, versioned, and audited
6. Schema-light by default (tags + labels), schema-strict where an admin defines it (required fields, enums, types)
7. Storage behind an interface so the backend can move from JSON → SQLite → Postgres/OpenSearch without API changes

### Non-goals

- Making metadata part of the oxen commit history (see §6 decision on versioned file metadata)
- Real-time cross-node index replication (single auth BFF instance assumed, as today)

## 4. Entity model

### 4.1 Entity reference (`EntityRef`)

Canonical, URL-safe, stable string key plus structured parts:

| `type` | `id` format | Example | Notes |
| --- | --- | --- | --- |
| `namespace` | `<ns>` | `acme` | |
| `repo` | `<ns>/<repo>` | `acme/data` | |
| `branch` | `<ns>/<repo>@<branch>` | `acme/data@main` | Name-based; renames need migration hook |
| `commit` | `<ns>/<repo>#<commit_id>` | `acme/data#9f2c…` | Immutable target |
| `file` | `<ns>/<repo>:<path>` (+ optional `@<commit>` pin) | `acme/data:img/a.png` | Unpinned = follows path across commits (see §6) |
| `directory` | `<ns>/<repo>:<dir>/` (trailing slash) | `acme/data:img/` | Same pin rules as `file`; repo root = the `repo` entity |
| `workspace` | `<ns>/<repo>!<workspace_id>` | | |
| `job` | `<job_id>` | | Already globally unique |
| `session` | `<session_id>` | | |
| `user` | `<iss>\|<sub>` | | Principal, matches audit actor |
| `group` | `<iss>\|group:<name>` | | IdP group |
| `custom_role` | `<scope>/<role_id>` | | |
| `access_request` | `<id>` | | |
| `dataframe` / `column` | `<file ref>#col:<name>` | | Link/mirror of oxen schema metadata (phase 3) |

`EntityRef = { type, id, namespace?, repo? }` — `namespace`/`repo` are denormalised on every record for AuthZ scoping and index filtering.

Entity existence is **not** enforced by the metadata store for historical/immutable targets, but is validated on write via a per-type `resolveEntity()` (404 if unknown, 403 if no permission).

### 4.2 Metadata record

```ts
type MetaRecord = {
  ref: EntityRef
  revision: number                 // monotonically increasing per entity
  description?: string             // markdown, ≤ 8 KB, indexed (high weight)
  tags: string[]                   // lowercase slug, ≤ 50, indexed, faceted
  labels: Record<string, string>   // flat key → string, ≤ 100 keys (k8s-style)
  fields: Record<string, MetaValue> // schema-typed values (see 4.3)
  updatedAt: string
  updatedBy: AuditActor            // same shape as audit actor
  createdAt: string
}
type MetaValue = string | number | boolean | string[] | { date: string } | { ref: EntityRef }
```

Size limits (enforced server-side): record ≤ 64 KB serialized, key ≤ 64 chars `[a-z0-9_.-/]`, value string ≤ 2 KB.

### 4.3a Own vs effective metadata

A `MetaRecord` (§4.2) holds only the metadata **set directly on that entity** (*own* metadata). What users see and search is the **effective** metadata: the result of resolving the entity's ancestor chain (§4.4). The API returns both, with per-item provenance:

```ts
type EffectiveMeta = {
  ref: EntityRef
  own: MetaRecord | null
  effective: {
    description?: Sourced<string>
    tags: Sourced<string>[]                  // union across chain, minus removed
    labels: Record<string, Sourced<string>>
    fields: Record<string, Sourced<MetaValue>>
  }
  chain: EntityRef[]                         // resolved ancestors, root → leaf
}
type Sourced<T> = {
  value: T
  from: SourceLink            // where the winning value is defined
  inherited: boolean
  overridden?: SourceLink[]   // ancestors whose value was shadowed, nearest first
  removedBy?: SourceLink      // set on tags/labels/fields negated by a lower level
}
type SourceLink = {
  ref: EntityRef
  label: string               // display name, e.g. "acme" / "acme/data" / "img/"
  url: string                 // UI route to the source entity's metadata panel (anchored to the item)
  revision: number            // own-record revision that set the value
  setBy?: AuditActor          // who set it (from history)
  setAt?: string
  readable: boolean           // false when the viewer cannot read the source entity (see §9)
}
```

### 4.3 Field definitions (optional schema)

Admin-defined, per entity type and optionally scoped to a namespace:

```ts
type MetaFieldDef = {
  key: string                  // e.g. "gxp_class"
  label: string                // UI name
  type: 'string' | 'text' | 'number' | 'boolean' | 'date' | 'enum' | 'multi_enum' | 'entity_ref' | 'url'
  entityTypes: EntityType[]    // where it applies
  scope: { namespace?: string }// undefined = instance-wide
  required?: boolean
  options?: string[]           // enum values
  searchable: boolean          // included in full-text
  facet: boolean               // available as facet/filter
  sensitive?: boolean          // hidden from users without `view_sensitive_meta`
}
```

Undefined keys are allowed only under `labels` (free-form); `fields` must match a definition when any definition exists for that type.

### 4.4 Composition & inheritance

**Parent chain** (each entity has exactly one parent; resolved by `resolveParent()` per type):

| Entity | Parent |
| --- | --- |
| `namespace` | *(instance root, optional `instance` ref for instance-wide defaults)* |
| `repo` | `namespace` |
| `branch`, `commit`, `workspace`, `job` | `repo` (job: the repo it targets) |
| `directory` | parent directory, up to the `repo` root (`acme/data:img/cats/` → `acme/data:img/` → `acme/data`) |
| `file` | enclosing `directory` (or `repo` for root-level files) — files inherit through every directory above them to the repo (`acme/data:img/cats/a.png`) |
| `session` | `user` (owner) — and, if mounted, no repo inheritance in v1 |
| `custom_role`, `access_request`, `group` | `namespace` where scoped, else instance |
| `user` | instance |

Resolution walks leaf → root and merges **root first, leaf last** (closest wins). Effective chain for `acme/data:img/a.png@<commit>`: `instance → namespace acme → repo acme/data → dir img/ → file`.

**Merge rules** (deterministic, per field type):

| Item | Rule | How a descendant opts out |
| --- | --- | --- |
| `description` | Nearest non-empty wins (replace) | Set own description (empty string = explicitly blank) |
| `tags` | Applied **root → leaf**: each level adds its `tags` and subtracts its `removeTags`; **the latest (lowest) level's statement about a tag wins**, so a child can remove an inherited tag and a grandchild can re-add it | `removeTags: ["x"]` in own record (a negative tag; `-x` in the UI); re-add by listing it in `tags` at a lower level |
| `labels` | Per-key; nearest value wins | Set the key to a new value, or `unset: ["key"]` to drop it |
| `fields` | Per-key; nearest value wins. `multi_enum` / `string[]` fields use the definition's `merge: 'replace' \| 'union'` (default `replace`) | Set a new value, or `unset: ["key"]` |
| `sensitive` | Inherited with the value; visibility still checked per viewer | — |

Own record gains explicit override markers (so "not set" ≠ "removed"):

```ts
type MetaRecord = {
  …                                // §4.2
  removeTags?: string[]            // negate inherited tags
  unset?: { labels?: string[]; fields?: string[]; description?: boolean }
  inherit?: boolean                // default true; false = cut the chain here (don't inherit from ancestors)
  lock?: { labels?: string[]; fields?: string[]; tags?: string[] }  // Phase 3: ancestor-enforced values descendants cannot override
}
```

Semantics:

- **Tag precedence:** the level closest to the entity (latest in the chain) decides. `ns: +gxp` → `repo: -gxp` (removed) → `dir: +gxp` (back). A single record listing the same tag in both `tags` and `removeTags` is rejected (422). Precedence is by position in the chain, not by edit timestamp.
- **Override** = own value present → wins; ancestors shown in `overridden[]` for transparency.
- **Unset / remove** = explicit tombstone entry; survives later changes on the parent (a parent change never silently re-adds a removed item).
- **`inherit: false`** stops the walk at that entity (it becomes a new root for its subtree).
- **Locks** (Phase 3, governance): a namespace owner can lock e.g. `gxp_class` so repos cannot override it; enforced at write time (422 with the locking ancestor named) and in resolution.
- **Deletes/renames of a parent**: descendants lose inheritance from it (tombstoned parent is skipped in resolution but retained in history, §8).
- **Pinned immutables** (`commit`, pinned `file@commit`): resolved against the *current* ancestor metadata by default; optional **snapshot-on-release** freezes the effective metadata into the pinned record (GxP evidence that the inherited value at release time is preserved).
- **Cycle safety / depth**: chains are acyclic by construction (type-fixed parents); resolution capped at 8 levels.
- **Composable mixins / profiles** (Phase 3): reusable named bundles (e.g. profile `gxp-regulated` = tags + fields) applied to any entity as `profiles: string[]`; resolved between parent and own in the merge order (`parent → profiles (in order) → own`). Keeps inheritance as the primary mechanism, profiles for cross-cutting reuse.

**Query semantics:** search matches on **effective** metadata by default (a repo under namespace `acme` tagged `gxp` is found by `tag:gxp`). Filters `own=true` (own only) and `inherited=true` (only via inheritance) are available; each hit shows provenance.

### 4.5 Source tracing & navigation

Every effective value is traceable to the record that defines it:

- **Resolution returns `SourceLink`s** (§4.3a) for the winning value, shadowed ancestors, and removals, so the UI never has to re-walk the chain.
- **Deep links:** `url` points to the source entity's metadata panel with the item anchored/highlighted, e.g. `/n/acme?meta=label:env`, `/n/acme/r/data/meta?tag=gxp`, `/n/acme/r/data/blob/main/img/?meta=field:gxp_class`. Links are stable and shareable; the target panel opens at the **revision** that set the value when it differs from the current one (history drawer).
- **Chain view:** `GET /auth/meta?…&trace=<kind>:<key>` (e.g. `trace=label:env`, `trace=tag:gxp`, `trace=field:gxp_class`) returns the ordered chain for one item: each level, whether it set / overrode / removed / re-added it, the value at each level, and who/when (from history). Used by the UI "Trace" popover.
- **Reverse navigation (parent → children):** `GET /auth/meta/descendants?…&key=<kind>:<key>` lists entities that *inherit*, *override*, or *remove* a given item, with links, so a namespace owner can answer "where does `gxp_class` come from and who changed it?" in both directions. Counts shown inline ("inherited by 42, overridden in 3").
- **Search results** show a source chip per matched item ("from namespace `acme` ▸"), clickable to the source; for sparse file/directory matches (§5.2) the chip is the nearest annotated ancestor.
- **History cross-link:** each source link opens the source's history at the `revision`; history entries link back to the audit event (`meta.set` id) for the full who/what/when/why.
- **Unreadable sources:** if the viewer can read the entity but not the source ancestor, the badge shows the ancestor's type and name only (so provenance is truthful) with `readable: false` and no link; no other metadata of that ancestor is exposed (§9).
- **Tombstoned/deleted sources:** link resolves to the retained history view (read-only) with a "source deleted" notice; CLI/API still return the last known `SourceLink`.

## 5. Storage & indexing

### 5.1 Stores (behind `MetaStore` interface)

| Phase | Backend | Rationale |
| --- | --- | --- |
| 1 | JSON file (`AUTH_DATA_DIR/meta.json`) + JSONL revision log (`meta-history.jsonl`), in-memory index rebuilt on boot | Matches existing stores, zero new infra |
| 2 | **SQLite** (`better-sqlite3`) with FTS5 virtual table + normalized `meta_tag`, `meta_label`, `meta_field` tables | Real indexes, transactional, still single-file, scales to ~1M records |
| 3 (optional) | Postgres / OpenSearch adapter | Multi-node, advanced relevance |

Interface sketch:

```ts
interface MetaStore {
  get(ref): MetaRecord | null
  put(ref, patch, actor, ifRevision?): MetaRecord      // optimistic concurrency
  delete(ref, actor): void
  history(ref, cursor?): MetaRevision[]
  search(q: MetaSearchQuery, scope: AuthzScope): MetaSearchResult
  facets(q, scope): FacetCounts
  reindex(): Promise<void>
}
```

### 5.2 Index design (SQLite phase)

**Strategy: materialize effective metadata into the index; keep own records as source of truth.** Resolving the chain per query would make facets/search O(depth × N); instead each entity row stores its effective tags/labels/fields (with `source_ref` and `inherited` flags), recomputed on change.

- **Fan-out on write:** editing metadata on an entity enqueues a recompute for its **descendant subtree** (namespace → all repos → branches/files/jobs/…). Recompute is idempotent, batched in a transaction, and bounded by namespace/repo scope; large fan-outs run async with an index `generation` marker (`pending` rows shown as "updating…" and exposed in `GET /auth/meta/index/status`).
- **Reverse lookups:** `meta_entity.parent_key` + `meta_entity.path_chain` (materialized ancestor keys) allow `WHERE path_chain LIKE 'ns:acme/%'`-style subtree selection without recursion.
- **Files and directories are materialized sparsely.** A row exists only for files/dirs with **own** metadata (or pinned snapshots). Un-annotated files resolve **lazily at read time** by walking up to the nearest annotated directory/repo (cached per `(repo, revision, path)`), so a namespace tag never fans out to millions of file rows. Search consequences: a query like `tag:gxp type:file` returns annotated files directly; files that only *inherit* a match are reached via their nearest annotated ancestor, shown as \"applies to all files under `img/`\" with a drill-down that lists files from the oxen tree on demand. Repo-level and above stay fully materialized.
- **Entity creation:** a new repo/job/session computes its effective row from the parent at creation (hook), so it is searchable by inherited metadata immediately.
- **Re-parenting** (rare: repo transfer between namespaces, if ever added) triggers a subtree recompute.
- **Consistency check:** startup/`reindex` recomputes all effective rows from own records and diffs against the index (reports drift).

- `meta_entity(ref_key PK, type, namespace, repo, parent_key, path_chain, revision, updated_at, …)` and `meta_own` (own records, truth) vs `meta_effective_*` projections below
- `meta_fts` FTS5 over: `description`, tags, label k/v, searchable field values, **entity display name** (repo name, file path, job name…) — weights: name > tags > description > fields
- Normalized effective tables for exact/range filters: `meta_tag(ref_key, tag, source_key, inherited)`, `meta_label(ref_key, k, v, source_key, inherited)`, `meta_field(ref_key, key, str, num, date, source_key, inherited)` with composite indexes on `(key, str)`, `(key, num)`, `(tag)`, `(namespace, repo, type)`
- Index is a **derived projection**; source of truth is the record table + history. `POST /auth/meta/reindex` (admin) rebuilds it.
- Index hooks: entity rename/delete events (repo delete, namespace delete, session/job cleanup) tombstone or move metadata (§8).

### 5.3 Entity names in search

Search should also match entities with **no metadata** by name (repo, job name, session name). Phase 1 only returns entities with metadata; Phase 2 adds a lightweight `meta_entity` row for every entity (name-only) populated by event hooks and a startup backfill.

## 6. Key design decisions

| # | Decision | Recommendation |
| --- | --- | --- |
| D1 | Where does metadata live — oxen-server or auth BFF? | **BFF store.** oxen-server has no generic metadata API for most entities (jobs, sessions, users, workspaces). One store = one index and one AuthZ path |
| D2 | File metadata: pinned to commit or follows path? | Support both: `file:path@commit` is immutable evidence (GxP); unpinned `file:path` is "current". UI shows pinned metadata for the viewed commit and falls back to unpinned |
| D3 | Should metadata edits create oxen commits? | **No.** Metadata is not data; avoids commit noise and merge conflicts. Provide revision history + audit instead. Optional export of metadata snapshot into repo as `.mice/metadata.json` (Phase 4) |
| D4 | Tags vs labels vs fields | Tags = unordered keywords, labels = free-form k/v, fields = governed/typed. All searchable; only fields can be required/typed |
| D5 | Concurrency | Optimistic: `If-Match: <revision>` / `ifRevision`; 409 on mismatch |
| D7 | Inherit by copy or by reference? | **By reference** (resolve + materialize in index). Copying values down would diverge silently and break "change once, applies everywhere" |
| D8 | Parent change vs. explicit child removal | Child tombstones (`removeTags`, `unset`) always win and are never re-added by later parent edits |
| D9 | Tags merge by union, not replace | Matches the "derive unless overridden" intent; removal is explicit via `removeTags` |
| D6 | Deletion semantics | Entity deleted → metadata **tombstoned** (kept for audit/GxP, hidden from search); hard purge only via admin + audited |

## 7. API (auth BFF)

All under `/auth/meta`, session or PAT, JSON.

| Method & path | Purpose | Permission (see §9) |
| --- | --- | --- |
| `GET /auth/meta?type=&id=&view=effective\|own` | Get one entity; default `effective` returns `{ own, effective, chain }` with provenance (§4.3a); `own` returns only the direct record | read on entity |
| `PUT /auth/meta` body `{ ref, description?, tags?, removeTags?, labels?, fields?, unset?, inherit?, ifRevision? }` | Replace-merge **own** record (never writes inherited values down) | `edit_metadata` on entity |
| `PATCH /auth/meta` | JSON-merge patch (add/remove tags, set/unset label) | `edit_metadata` |
| `DELETE /auth/meta?type=&id=` | Remove record (tombstone) | `edit_metadata` |
| `GET /auth/meta/history?type=&id=` | Revision list + diffs (own record) | read on entity |
| `GET /auth/meta?…&trace=<kind>:<key>` | Ordered per-level trace of one tag/label/field (set / override / remove / re-add, value, who, when, links) | read on entity |
| `GET /auth/meta/descendants?type=&id=&type[]=&key=<kind>:<key>` | Entities under a parent with their effective metadata + which are overriding a given key ("who overrides `gxp_class`?") | read on parent, results scoped |
| `POST /auth/meta/preview` body `{ ref, patch }` | Dry-run: returns the effective-metadata diff for the entity **and its affected descendants** (count + sample) before saving | `edit_metadata` |
| `GET /auth/meta/search` | Query: `q`, `type[]`, `own`/`inherited` (provenance filter), `namespace`, `repo`, `tag[]`, `label.<k>=<v>`, `field.<k>=<v>` (`gte/lte` for number/date), `sort`, `cursor`, `limit` | scoped by AuthZ |
| `GET /auth/meta/facets` | Counts for tags / types / field facets given the current query | scoped |
| `GET /auth/meta/fields` / `POST` / `PUT` / `DELETE` | Field definitions CRUD | instance admin (instance-wide) / ns owner (ns-scoped) |
| `POST /auth/meta/bulk` | Apply tags/labels to many refs (selection from UI/CLI) | `edit_metadata` per ref; partial-failure report |
| `GET /auth/meta/export.csv` | Export search results (same filters), mirrors audit export | scoped |
| `POST /auth/meta/reindex` | Rebuild index | instance admin |

Response objects always include a resolved `entity` summary (`name`, `url`, `type`) so the UI can link results without extra calls.

Search syntax sugar in `q`: `tag:foo`, `type:repo`, `label.env:prod`, `field.status:approved`, quoted phrases, `-` negation; parsed server-side to the structured query (the UI also builds the structured form directly).

## 8. Lifecycle & integrity

- **Rename/move** (repo rename, branch rename, file move via lineage `move`): hook updates `ref` and writes a history entry; for files, [TRACEABILITY.md](./TRACEABILITY.md) lineage can resolve a moved path so unpinned metadata follows renames.
- **Delete**: namespace/repo/job/session deletion hooks tombstone dependent metadata (cascade by `namespace`/`repo` denormalised fields).
- **Orphan sweeper**: periodic task flags metadata whose entity no longer resolves.
- **Immutable targets** (`commit`, pinned `file`) cannot be orphaned by edits; metadata is still editable (metadata ≠ target) but history is retained.
- **Backups**: `meta.json`/SQLite file lives in `AUTH_DATA_DIR`; included in existing volume.

## 9. AuthZ

New atomic permissions in `authzTypes.ts` / catalog ([AUTHO.md](./AUTHO.md)):

| Permission | Scope | Meaning |
| --- | --- | --- |
| `view_metadata` | repo / namespace | Read metadata on entities in scope (implied by repo read) |
| `edit_metadata` | repo / namespace | Create/update/delete tags, labels, fields (implied by write; Owners always) |
| `manage_meta_schema` | namespace / instance | Manage field definitions |
| `view_sensitive_meta` | namespace / instance | See `sensitive` fields |
| `admin_meta_index` | instance | Reindex, purge |

Rules:

- **Writing a parent's metadata** (e.g. namespace) requires `edit_metadata` at that parent's scope; it **does not** require write access to each descendant, but descendants' own overrides are never changed by a parent edit.
- **Reading effective metadata** requires read on the entity; inherited values from ancestors the viewer cannot read are still shown when they apply to an entity the viewer can read (inheritance is part of the entity's description), but the ancestor's *other* metadata/existence is not exposed. `sensitive` values obey `view_sensitive_meta` regardless of source.
- Metadata visibility = visibility of the target entity (repo read for repo/branch/commit/file/workspace; job read for job; session owner/admin for session; user/group metadata → instance-admin or self-read configurable).
- **Search is filtered before paging** (lesson from the audit `ownedOnly` bug): compute the caller's allowed `(namespace, repo)` set and apply it inside the query, never post-filter.
- Result counts and facets are computed over the allowed set only (no existence leaks).
- Existing `repo.metadata` (oxen repo settings) keeps its current admin mapping; new actions are separate names (`meta.*`) so authz prefix rules stay unambiguous.
- Custom roles: add the new fine permissions to the custom-role catalog (`customRoles.ts`).

## 10. Audit & GxP

New audit actions (add to `auditLabels.ts`, group **Metadata**):

| Action | Label |
| --- | --- |
| `meta.set` | Metadata updated |
| `meta.override` | Inherited metadata overridden / removed |
| `meta.delete` | Metadata removed |
| `meta.bulk` | Metadata bulk-edited |
| `meta.field.create` / `update` / `delete` | Metadata field defined / changed / removed |
| `meta.reindex` | Metadata index rebuilt |
| `meta.export` | Metadata exported |

Audit `detail`: `{ entity_type, entity_id, revision, changed: { tags, labels, fields }, affected_descendants: <count> }` — a parent edit is **one** audit event (with the affected count), not one per descendant; recomputed effective rows are derived data and not audited individually. Events carry **old/new values for GxP-relevant fields** (diff, not full record). Audit `namespace`/`repo` filled from the entity ref so existing scoped audit works; add `entity_id` detail key + audit filter (extends the Session/Workspace/Job filters).

Ties to [`PLAT-GXP`](./GXP.md): optional per-field `requireReason` so changing a governed field demands a reason/change-control id captured in the audit event.

## 11. Web UI

1. **Metadata panel** (reusable `<MetaPanel entityRef>`): description, tags chips, labels table, typed fields form, "History" drawer. Every item shows a **provenance badge** that is a **link to the source** (opens the source entity's metadata panel with the item highlighted, at the revision that set it), plus a **Trace** popover rendering the chain (`namespace acme: env=prod → repo data: env=staging (override) → dir img/: —`) with who/when per level. Source-side panels show an **"Inherited by / overridden in"** list per item with counts and links to the children. Badge text: "from namespace `acme`" / "own" / "overrides `acme`". Inherited items have an **Override** action; own overrides have **Reset to inherited**; tag chips support remove-inherited (`-tag`); a toggle "Show own only / effective"; a **"Stop inheriting"** switch. Editing a parent shows an **impact preview** ("affects 42 repos, 17 override") before save. Embedded in: repo aside, file/blob page, commit page, branch page, workspace page, job detail, session detail, user profile.
2. **Search page** `/search` (matches effective metadata; provenance filter *own / inherited*): global search box in the top nav (⌘K quick-open) + full page with facet sidebar (type, namespace, tags, field facets), result cards with entity link + highlighted snippets, URL-persisted filters, **Export CSV** (reuses audit export pattern).
3. **Schema admin** (Settings → Metadata fields): table + editor for field definitions.
4. **Bulk tagging**: multi-select in lists (repos, jobs, files) → "Add tags / set label".
5. Empty/error/loading states via existing `StateBlock`; naming consistent with Audit labels.

## 12. Phased delivery

### Phase 1 — Core model + API (BFF)

> **Status: implemented.** `auth/src/meta*.ts`, `/auth/meta*` routes, `/meta` and `/meta/search` pages, unit tests (`meta.test.ts`) and e2e (`meta.spec.ts`).
> Deviations: Phase 1 reuses existing permissions (namespace `manage_settings`; repo write or fine permission `manage_repo_metadata` via action `meta.set`; dedicated `view_metadata`/`edit_metadata` deferred to Phase 3). Audit actions are `meta.set`, `meta.delete`, `meta.export` (`meta.override` dropped; overrides are `meta.set`). Search is in-memory over JSON (SQLite FTS in Phase 2). Not yet in UI: descendants panel, embedded panels on namespace/repo pages.
- [x] `metaTypes.ts` (EntityRef, MetaRecord incl. `removeTags` / `unset` / `inherit`, limits, validation), `metaStore.ts` (JSON + history JSONL, in-memory inverted index)
- [x] `SourceLink` generation in resolution + `trace` and `descendants?key=` endpoints (§4.5)
- [x] `metaResolve.ts`: `resolveParent()` per entity type (including the file → directory → repo chain), `resolveEffective()` merge (§4.4) with provenance, depth cap; index stores effective rows with fan-out recompute on parent change
- [x] `metaRoutes.ts`: get/put/patch/delete/history/search/facets
- [x] Entity resolver for `namespace`, `repo`, `branch`, `commit`, `file`, `directory`, `job`, `session`, `workspace`
- [x] AuthZ: new permissions, scope-before-paging search
- [x] Audit actions + labels
- [x] Unit tests (`meta.test.ts`): validation, limits, optimistic concurrency, search ranking/filters, authz scoping, tombstones

### Phase 2 — UI + SQLite index
- [ ] `<MetaPanel>` on repo, file, job, session, workspace pages with source links, Trace popover and "inherited by / overridden in" lists
- [ ] `/search` page + nav quick search, facets, CSV export
- [ ] Migrate store to SQLite + FTS5 behind `MetaStore`; JSON→SQLite import; `reindex`
- [ ] Name-only entity rows + backfill
- [ ] e2e tests (set/search/facet/authz/export/audit)

### Phase 3 — Governance
- [ ] Locks, mixins/profiles, snapshot-on-release for pinned entities
- [ ] Field definitions CRUD + schema-validated `fields`, enums, required, sensitive
- [ ] `requireReason` for GxP fields; bulk edits; history diff UI
- [ ] Lifecycle hooks (rename, delete cascade, orphan sweeper)
- [ ] Dataframe/column schema metadata mirror (read-through from oxen, searchable)
- [ ] Field-level protection for `sensitive` fields: redacted (not just hidden) in API, history, audit diffs, search snippets/facets, CSV export and index; optional encryption at rest (key source and rotation) — see Q7
- [ ] Authoritative reindex/rebuild contract: `reindex` rebuilds the index from own records + history only, is idempotent and resumable, reports drift, and defines index state after repo/branch rename, delete and a crash mid fan-out (`generation` marker, `pending` rows) — see Q8
- [ ] Export (CSV and `.mice/metadata.json`) audit and masking: every export audited with filter, row count and masked-field list; `sensitive` fields masked unless `view_sensitive_meta`; formula-guard retained — see Q9
- [ ] Controlled field-schema versioning and migration: `MetaFieldDef` carries a `version`; breaking changes (type change, enum removal, newly `required`) need a migration plan/dry-run, and existing values are re-validated, not silently dropped — see Q10
- [ ] Documented validation error contract: stable 422 body `{ code, path, message, limit? }` per violation (all violations listed), and stable codes for 409 (`ifVersion`/`ifRevision` mismatch) and lock conflicts

### Phase 4 — Extensions (optional)
- [ ] Snapshot export of metadata into repo (`.mice/metadata.json`) at a commit
- [ ] CLI/PAT scripts (`mice meta set/get/search`), webhook/export to external catalogs
- [ ] Postgres/OpenSearch adapter; semantic search plugin

## 13. Testing strategy

| Layer | Coverage |
| --- | --- |
| Unit — composition (`metaResolve.test.ts`) | Chain per entity type (file → nested directories → repo → namespace); tag add/remove/re-add precedence (latest level wins); same-tag in `tags` and `removeTags` → 422; closest-wins for labels/fields; tag union; `removeTags`/`unset` survive parent edits; `inherit:false` cut; empty description override; depth cap; provenance + `overridden[]`; locks (422); deleted-parent skipped; profile ordering |
| Unit (`auth/src/meta.test.ts`) | EntityRef parse/format, validation & limits, merge/patch semantics, revision + `ifRevision` 409, tag/label/field filters, text ranking, range queries, tombstone hiding, CSV escaping/formula guard (reuse `csvCell`) |
| AuthZ unit | Per entity type: allow/deny matrix; search/facets never leak counts; scope applied before paging |
| e2e inheritance | Source link on an inherited item navigates to the namespace panel with the item highlighted; Trace popover lists each level in order with override/remove/re-add; source panel shows "inherited by / overridden in" counts that match; unreadable source shows name-only badge without a link; deleted source opens read-only history; Tag a namespace → new and existing repos show it as inherited and are found by search; override a label in one repo → only that repo changes, badge shows override; remove inherited tag; edit namespace → descendants update (impact preview count correct); reset to inherited; audit has a single parent event |
| e2e (`e2e/tests/meta.spec.ts`) | Set metadata on repo/file/job/session via UI; search by text/tag/label/field; facets narrow results; unauthorized user gets 403/empty; export CSV honors filters; audit rows `meta.set` with diff; reindex restores results |
| Performance | Seed 100k records; p95 search < 200 ms (SQLite phase); reindex time documented; fan-out recompute of one namespace with 1k repos / 100k descendants completes in bounded batches without blocking requests |

## 14. Risks & open questions

| # | Item | Mitigation / question |
| --- | --- | --- |
| R1 | JSON store won't scale / blocks event loop on large writes | Phase 2 SQLite; keep `MetaStore` interface strict from day one |
| R2 | Metadata leaking via search/facets/counts | Authz scope inside query; tests for each entity type |
| R3 | Entity identity drift (renames, path moves) | Lifecycle hooks + lineage resolution; tombstones keep history |
| R4 | Unbounded free-form data (PII / secrets) | Size & key limits, `sensitive` flag, docs; optional pattern scanner for secrets |
| R6 | Fan-out cost: a namespace edit touches every descendant row | Batched async recompute, `path_chain` subtree selection, impact preview, status endpoint; cap synchronous fan-out and queue the rest |
| R7 | Surprising inheritance (value appears from far away) | Mandatory provenance in API/UI, `own`/`inherited` filters, `descendants` override report |
| R5 | Index drift from source of truth | Derived index + `reindex` + startup integrity check |
| Q1 | Should file metadata default to pinned or unpinned? | Proposal: unpinned default, pin on "approve/release" actions |
| Q2 | Are user/group metadata visible to all members or admins only? | Proposal: admins + self |
| Q3 | Do we need per-namespace schemas in v1 or instance-wide only? | Proposal: instance-wide in Phase 1, namespace-scoped in Phase 3 |
| Q5 | ~~Should files inherit through directories in v1?~~ | **Decided: yes.** Files inherit through all directories up to the repo (Phase 1) |
| Q6 | ~~Tag removal semantics at multiple levels?~~ | **Decided: latest (closest to the entity) statement wins** — own add beats ancestor removal and vice versa |
| Q4 | Is SQLite acceptable as a new runtime dependency in the auth image? | Needs `better-sqlite3` native build in `auth/Dockerfile` |
| Q7 | `sensitive` fields: redact vs. encrypt? Who holds keys, and are old history revisions re-encrypted on rotation? | Open. Proposal: redact everywhere by default; encryption at rest only if GxP/PII demands. Today `sensitive` is only a definition flag (no enforcement in `auth/src/meta*.ts`) |
| Q8 | After rename/delete/crash, is the index or the own-record store authoritative, and may reindex run online? | Open. Proposal: own records + history are authoritative; reindex builds into a new `generation` and swaps atomically; the old generation serves reads until then |
| Q9 | Export masking and audit: which fields are masked, and is a masked export distinguishable from a full one? | Open. Proposal: `meta.export` audit detail lists filters, count and `masked: true/false` |
| Q10 | Field-schema migration: who approves a breaking definition change, and are existing records grandfathered or blocked? | Open. Proposal: grandfather with a `needs_migration` flag; block only new writes |

## 15. Epic entry (to add to [EPICS.md](./EPICS.md))

```md
## PLAT-META — Entity metadata, indexing & search

**Goal:** Attach governed, auditable metadata (tags, labels, typed fields) to every system entity and make it searchable across the platform with AuthZ-scoped results.

**Status:** Partial (Phase 1 implemented; Phases 2–4 open)

**Plan:** [META.md](./META.md)

### TODO

- [ ] Generic entity-ref metadata model + BFF API (get/put/patch/delete/history)
- [ ] Composable metadata: namespace → repo → … inheritance with override/unset, provenance, locks, effective-metadata index
- [ ] AuthZ permissions (view/edit metadata, manage schema) and custom-role catalog entries
- [ ] Full-text + facet search (scope-before-paging), CSV export
- [ ] Metadata panel on every entity page + global search page
- [ ] Field definitions (typed, required, sensitive) and bulk edit
- [ ] Audit actions for all metadata mutations (with diffs)
- [ ] Lifecycle hooks (rename/delete), reindex, SQLite FTS backend
```
