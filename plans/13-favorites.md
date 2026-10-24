# FAVORITES — PLAT-FAV implementation plan

Personal **favorites** for the main entities. Favorites are pinned to the top of the existing listings (as a default sort option) and collected in a **Favorites panel on the Profile page**, with one tab per entity type.

Related: [EPICS.md](./EPICS.md) · [02-authorization.md](./02-authorization.md) · [12-metadata-search.md](./12-metadata-search.md) · [14-notifications.md](./14-notifications.md) · [03-audit.md](./03-audit.md) · [09-jobs.md](./09-jobs.md) · [10-sessions.md](./10-sessions.md)

## 1. Decisions (from product Q&A)

| # | Topic | Decision |
| --- | --- | --- |
| D1 | Entities | Namespaces, repositories, branches, workspaces, jobs, sessions. Files/directories, dataframes and users are **out of scope** (extensible later via the entity-ref contract) |
| D2 | Ownership | **Personal only.** No shared/team favorites |
| D3 | Listing order | A **sort option, "Favorites first", selected by default** in the same list (no separate section or divider). Remaining sort is the list's existing sort, applied within the favorites group and within the rest |
| D4 | Limit | **Unlimited** per user (server still enforces a defensive hard ceiling, see §5) |
| D5 | Stale entities | Entity deleted (or renamed away) → favorite is **auto-deleted** |
| D6 | AuthZ | Anyone who can **read** the entity can favorite it. Losing access → favorite is **hidden** (not deleted) and reappears if access returns |
| D7 | Audit | **Not audited** (personal UI state, not GxP data). Called out in 03-audit.md as an explicit exclusion |
| D8 | Metadata | **Independent of PLAT-META.** No `is:favorite` filter, no star on MetaPage |
| D9 | CLI | `mice favorite add|remove|list` |
| D10 | Notifications | Favorited resources **notify by default** (implicit "watch"); explicit user mute always wins (§7) |
| D11 | Profile panel | **Tabs per entity type with counts** |
| D12 | UI affordance | **Icon-only star** in list rows and entity page headers |
| D13 | Storage | **BFF JSON store** under `AUTH_DATA_DIR` (like jobs/notifications), single-instance |

## 2. Current state

| Piece | Behavior |
| --- | --- |
| Listings | `NamespacesListPage`, `RepositoriesListPage`, `BranchesPage`, `WorkspacesListPage`/`WorkspacesPage`, `JobsListPage`/`JobsPage`, `SessionsListPage` — each with its own sort/filter; no per-user state |
| Profile | `ProfilePage.tsx` (tokens, notification entry points) |
| Per-user state in BFF | Notification preferences/inbox (`notificationsStore.ts`), PATs (`tokens.ts`); atomic JSON via `jsonStore.ts` |
| Entity identity | Shared string ids already defined by PLAT-META (`ns`, `ns/repo`, `ns/repo@branch`, `ns/repo!workspace`, job id, session id) — reused here |
| Access checks | `authz.ts` (repo/namespace read), `authorizeJobRead`, `authorizeSessionAccess` |

## 3. Data model

Entity reference (reuse META's type/id grammar):

```ts
type FavoriteType = 'namespace' | 'repo' | 'branch' | 'workspace' | 'job' | 'session'
type FavoriteRef = { type: FavoriteType; id: string } // id per META grammar
type Favorite = FavoriteRef & { createdAt: string }
type FavoritesState = { version: 1; users: Record<string /* iss\0sub */, Favorite[]> }
```

- Key: `notificationUserKey`-style `iss\0sub`; identity never taken from the request body.
- Uniqueness: `(user, type, id)`; adding twice is idempotent (200, original `createdAt`).
- Store file: `AUTH_DATA_DIR/favorites.json`, atomic writes via `jsonStore.ts`.

## 4. API (BFF, `auth/src/favoritesRoutes.ts`)

Auth: cookie session **or unscoped PAT** (same `requireSession` rule as the other management routes; scoped PATs rejected).

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/auth/favorites?type=` | List caller's favorites, **filtered to readable entities** (D6), newest first. Response includes per-type `counts` |
| PUT | `/auth/favorites` `{ type, id }` | Add. 404 if entity does not exist, 403 if caller cannot read it |
| DELETE | `/auth/favorites` `{ type, id }` | Remove (idempotent) |
| POST | `/auth/favorites/lookup` `{ refs: FavoriteRef[] }` | Bulk "which of these are favorited?" for list views (cap 500 refs) |

Behavior notes

- **Read check per type** reuses existing gates (repo read, job read, session read, namespace visibility); a shared `canReadEntity(user, ref)` helper is introduced (META's `metaAuthz.ts` already has a close equivalent — reuse or extract).
- **Existence**: validated on add through the owning store/oxen lookup (cached like `metaRoutes`' repo cache).
- **Auto-delete (D5)**: hooks on delete paths — namespace delete, repo delete (also removes its branch/workspace/job favorites), branch delete, workspace delete, session destroy — call `purgeFavorites(ref | prefix)`. Plus a lazy sweep: `GET /auth/favorites` drops entries whose entity is confirmed gone (404 from owner), but never drops on transient errors or 403 (D6).
- **Renames**: repo/branch rename (if/when supported) rewrites ids; until then not applicable.
- Not audited (D7); no audit action is added.
- Rate/size: hard ceiling 10 000 favorites per user (defensive, not a product limit), body ≤ 8 KB.

## 5. Listing integration ("Favorites first" sort)

Frontend-only ordering using one bulk lookup per list page.

1. New `web/src/lib/favorites.ts`: API client, `useFavorites(type)` hook (fetch once, cache in memory, optimistic toggle with rollback), `isFavorite(ref)`.
2. New `FavoriteStar` component (icon-only, `aria-pressed`, tooltip "Add to favorites"/"Remove from favorites", keyboard accessible). Used in list rows and entity headers (D12).
3. New shared `sortWithFavorites(items, key, baseCompare)`: stable partition — favorites first, each group ordered by the page's existing sort (D3).
4. Each list toolbar (next to search/filter) has one **"Sort by"** dropdown, identical on every list: **Favorites** (default), **Newest**, **Oldest**, **Name (A–Z)**, **Name (Z–A)**. Name breaks ties. The choice persists per list in `localStorage` (`mice.sort.<list>`). "Newest" uses creation time where available (namespaces, workspaces, jobs, sessions), last commit for branches; repositories have no timestamp in Oxen, so it falls back to name. Implemented in `SortControl.tsx`.
5. Pages: Namespaces, Repositories, Branches, Workspaces, Jobs, Sessions lists; stars also in headers of NamespacePage, repo pages, BranchPage, WorkspacePage, JobPage, SessionPage.
6. Server-paginated lists (jobs, sessions): pinning only reorders the **loaded page** unless the API gets a `favorites_first` param. Phase 2 adds `?favorites=first` to `GET /auth/jobs` and `/auth/sessions` (server joins on the caller's favorites) so ordering is correct across pages. Open question Q2.

## 6. Profile panel

- New "Favorites" section in `ProfilePage.tsx`: tabs **Namespaces · Repositories · Branches · Workspaces · Jobs · Sessions**, each showing a count badge (zero-count tabs stay visible, muted). Default tab = first non-empty.
- Each row: icon, display name, parent context (e.g. `ns/repo`), link to the entity, "added <relative time>", and an unfavorite star. Empty state with a hint on how to favorite.
- Data from `GET /auth/favorites` (already read-filtered, with counts).
- Deep link `/profile?tab=favorites&type=jobs`.

## 7. Notifications integration (D10)

Notification preferences already hold `resourceOverrides: {resource, mode: 'watch'|'mute'}` with specificity-based resolution (`resourceIsMuted` in `notifications.ts`).

- Favorited resources behave as an **implicit `watch`** at the lowest precedence: effective mode = explicit override (any specificity) → else favorite → else default.
- Explicit **mute always wins** over favorite, including a mute on a parent (e.g. muted repo) — favoriting a job in a muted repo does not un-mute it unless the user sets an explicit watch on it.
- A favorite is an implicit watch only; it is not an explicit `watch` override.
- [ ] Explicit per-resource watch, distinct from favorite: the star and a watch control are separate, and the UI shows both states (favorited, watched, effective result). Proposed in [14-notifications.md](./14-notifications.md); unapproved.
- Not persisted into `resourceOverrides`: computed at delivery time from the favorites store, so unfavoriting restores defaults with no cleanup.
- Applies to event categories keyed to a resource: jobs (state changes), sessions, branches/repos (pushes, merges) per existing categories; category toggles and quiet hours still apply (a favorite never bypasses a disabled category — **to verify against current `watch` semantics**, Q3).
- Notification settings page shows a read-only hint: "Favorites notify by default; mute to override."

## 8. CLI

`cli/lib/admin.mjs` gains a `favorite` group (admin-style, PAT):

```
mice favorite list [--type namespace|repo|branch|workspace|job|session]
mice favorite add    <type> <id>     # ids per META grammar; inside a clone: bare branch/repo allowed
mice favorite remove <type> <id>
```

- [ ] Hand-off: `mice notifications list|read|watch` is specified in [14-notifications.md](./14-notifications.md) (PAT with a notifications scope); not part of the `favorite` group. Unapproved.

Same id resolution helper as `mice meta` (`resolveEntityId`) so `mice favorite add repo` inside a clone works. JSON output, unit tests in `admin.test.mjs`.

## 9. Interactions with other plans

| Plan | Impact |
| --- | --- |
| AUTHO | No new permission. Read-gate reused; documented as "any reader may favorite" |
| AUDIT | Explicit exclusion note; no new actions or labels |
| META | None (D8). Shared id grammar only |
| 14-notifications.md | New implicit-watch rule (§7); update the preference semantics section and `resourceIsMuted` callers |
| Jobs / Sessions | Optional `favorites=first` list param (Phase 2); delete hooks (D5) |
| GXP | Out of scope; favorites carry no regulated data |
| EPICS.md | New row `PLAT-FAV`, depends on AUTH, AUTHO |

## 10. Phases

| Phase | Scope | Exit criteria |
| --- | --- | --- |
| 1 — Core | Store, routes (`GET/PUT/DELETE/lookup`), read-gate helper, delete hooks + lazy sweep, unit tests | Idempotent add, read-filtering, auto-delete on entity removal, PAT works / scoped PAT rejected |
| 2 — UI | `favorites.ts`, `FavoriteStar`, sort option default-on, stars in list rows and headers, Profile tabs with counts | e2e: favorite a repo → appears first; Profile tab count updates |
| 3 — CLI | `mice favorite list/add/remove` | CLI unit tests + smoke against BFF |
| 4 — Notifications | Implicit watch in delivery eligibility, settings hint | Unit tests for precedence (mute > favorite > default) |
| 5 — Server-side ordering | `favorites=first` on jobs/sessions list APIs | Correct order across pages |

## 11. Test plan

- **Unit (auth):** add idempotency; per-user isolation; readable-filter hides then restores on access change; purge by exact ref and by repo prefix; defensive ceiling; lookup cap.
- **Unit (web):** `sortWithFavorites` stability and group ordering; optimistic toggle rollback.
- **Unit (cli):** request building and id resolution.
- **e2e:** favorite → list order + Profile tab count; unfavorite from Profile; delete repo → favorite gone; user without read access never sees it; second user unaffected.
- **Notification unit:** mute beats favorite; favorite beats default; disabled category still suppresses.

## 12. Open questions

| # | Question | Default if unanswered |
| --- | --- | --- |
| Q1 | Should the **branches** list pin favorites per repo only (yes, ids are per repo) or also appear in a cross-repo view? | Per repo only |
| Q2 | Server-side `favorites=first` for paginated jobs/sessions now, or accept page-local pinning in v1? | Page-local in v1, server-side in Phase 5 |
| Q3 | Does a favorite bypass a **disabled notification category** or only the per-resource mute default? | Does not bypass categories |
| Q4 | Do **cluster-visible instance admins** see favorites on entities they can only read via admin rights? | Yes, same read gate |
| Q5 | Cross-device behavior on login with SSO identity change (sub changes)? | Identity is `iss`+`sub` (ADR 0001): Principals are keyed `iss`+`sub`, no cross-IdP merging. A changed `sub` or a different IdP is a different Principal with its own favorites |

## 13. Implementation status

Implemented (v1): BFF store/routes (`favoritesStore.ts`, `favoritesRoutes.ts`, delete purge via audit observer, lazy sweep), web (`lib/favorites.ts`, `FavoriteStar`, Sort by + "Favorites first" control on all six lists, header stars, Profile panel), CLI `mice favorite`, notification hint.
Decisions on open questions: Q1 branches per repo only; Q2 jobs/sessions ordering is page-local (no `favorites=first` API param yet); Q3 a favorite never overrides a disabled category — since all accessible resources notify by default, the implicit watch needs no code beyond the hint; Q4/Q5 unchanged.
Note: the repo header keeps the existing browser-local "Star" button; the server-side favorite is the separate icon-only star next to the title.
