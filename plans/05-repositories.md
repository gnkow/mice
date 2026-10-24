# REPOSITORIES — PLAT-REPO implementation plan

Living design and phased plan for epic `PLAT-REPO` — **Namespaces, repositories & version browsing**. The epic is not yet listed in [EPICS.md](./EPICS.md); this document records what is already shipped so it can be added (Status `Partial`, depends on PLAT-AUTH, PLAT-AUTHO, emits PLAT-AUDIT).

Related: [EPICS.md](./EPICS.md) · [01-authentication.md](./01-authentication.md) · [02-authorization.md](./02-authorization.md) · [03-audit.md](./03-audit.md) · [04-gxp-compliance.md](./04-gxp-compliance.md) · [06-data-transfer.md](./06-data-transfer.md) · [07-cli.md](./07-cli.md) · [08-workspaces.md](./08-workspaces.md) · [11-lineage.md](./11-lineage.md) · [12-metadata-search.md](./12-metadata-search.md) · [13-favorites.md](./13-favorites.md) · [14-notifications.md](./14-notifications.md)

## 1. Purpose & scope

**In scope**

- Namespace and repository lifecycle in the UI (list, create, settings, delete, transfer)
- Version browsing: tree, blob, branches, commits, compare, merge
- DataFrame viewing and DataFrame compare
- How the BFF classifies, authorizes and audits the oxen routes these pages use

**Out of scope (see other plans)**

- Namespace/repo roles, membership and enforcement logic — [02-authorization.md](./02-authorization.md)
- Audit store/query design — [03-audit.md](./03-audit.md)
- Upload, import/export, large upload — [06-data-transfer.md](./06-data-transfer.md)
- Overlay workspaces/stages — [08-workspaces.md](./08-workspaces.md)
- File lineage — [11-lineage.md](./11-lineage.md); entity metadata and search — [12-metadata-search.md](./12-metadata-search.md)
- CLI clone/commit/push — [07-cli.md](./07-cli.md)

## 2. Current state

All pages call oxen-server through the BFF (`/api/...`) via [`web/src/lib/oxen/api.ts`](../web/src/lib/oxen/api.ts) and [`client.ts`](../web/src/lib/oxen/client.ts). Routes are declared in [`web/src/App.tsx`](../web/src/App.tsx) (repo pages nest under `n/:namespace/r/:repo` in `RepoLayout`).

| Area | Page(s) / route | Behavior (verified in code) |
| --- | --- | --- |
| Home | [`HomePage.tsx`](../web/src/pages/HomePage.tsx) `/` | Dashboard; loads recent jobs (`listJobs`, limit 100) and a storage-usage gauge |
| Namespaces list | [`NamespacesListPage.tsx`](../web/src/pages/NamespacesListPage.tsx) `/namespaces` | Search (`q`) + client-side pagination (`page` param); delete namespace with `confirmDelete` (calls `deleteNamespaceAuthz(..., { deleteRepositories: true })`) |
| Namespace create | [`NewNamespacePage.tsx`](../web/src/pages/NewNamespacePage.tsx) `/namespaces/new` | Creates namespace through the AuthZ API |
| Namespace home | [`NamespacePage.tsx`](../web/src/pages/NamespacePage.tsx) `/n/:namespace` | Summary card: repo/stage counts, base permission, "no access control" and "you: role" tags |
| Namespace settings | [`NamespaceSettingsPage.tsx`](../web/src/pages/NamespaceSettingsPage.tsx) `/n/:namespace/settings`, `/access` | Members add/change/remove, settings, cascade delete (detail owned by 02-authorization) |
| Repos list | [`RepositoriesListPage.tsx`](../web/src/pages/RepositoriesListPage.tsx) `/repositories` | Search + client-side pagination |
| Repo create | [`NewRepoPage.tsx`](../web/src/pages/NewRepoPage.tsx) `/repos/new` | `createRepository` → `POST /api/repos`; namespace picker shows caller role |
| Repo settings | [`RepoSettingsPage.tsx`](../web/src/pages/RepoSettingsPage.tsx) `.../settings` | Collaborators, **rename** (`.../rename`), **transfer** (`.../transfer`), **delete** (`confirmDelete`) |
| Tree | [`TreePage.tsx`](../web/src/pages/TreePage.tsx) `.../tree/:branch/*` | Directory listing, latest-commit banner, delete, rename/move/copy dialog, show/restore deleted-in-latest-commit |
| Blob | [`BlobPage.tsx`](../web/src/pages/BlobPage.tsx) `.../blob/:branch/*` | Tabs: preview / details / metadata / history / lineage; text (text/*, json, xml, js, yaml) and `image/*` preview, other types "binary" fallback; text edit; restore; download by hash/version |
| Branches | [`BranchesPage.tsx`](../web/src/pages/BranchesPage.tsx), [`BranchPage.tsx`](../web/src/pages/BranchPage.tsx) | List, create, delete (default branch blocked in UI), point branch at prior commit (`updateBranch`), merge an incoming commit into a branch (`mergeCommitIntoBranch`) |
| Commits | [`CommitsPage.tsx`](../web/src/pages/CommitsPage.tsx) `.../commits[/:commitId]` | Modes `history` (per revision, optional path filter) and `all` (`listAllCommits`); commit detail, parents, root commit |
| Compare | [`ComparePage.tsx`](../web/src/pages/ComparePage.tsx) `.../compare` | Commits + entries between two revisions, path filter, file-level diff (`compareFile`) |
| Merge | [`MergePage.tsx`](../web/src/pages/MergePage.tsx) `.../merge` | `checkMergeable` preview (commits, conflicts); Merge button enabled only when `is_mergeable` and zero conflicts; result shows base/head/merge ids |
| DataFrame | [`DataFramePage.tsx`](../web/src/pages/DataFramePage.tsx) `.../df/:branch/*` | Server-side paging (page size fixed 50), index; stages schema/column metadata into a workspace |
| DF compare | [`DataFrameComparePage.tsx`](../web/src/pages/DataFrameComparePage.tsx) `.../df-compare` | Create/update/delete compare, paged diff (50 rows/page) |
| Repo stats | `getRepositoryStats` / `getRepositorySize` / `updateRepositorySize` | Size and stats on repo overview (e2e R-07–R-09) |

Cross-cutting UI libs: [`lastBranch.ts`](../web/src/lib/lastBranch.ts) (remembers branch), [`confirmDelete.ts`](../web/src/lib/confirmDelete.ts), [`oxen/paths.ts`](../web/src/lib/oxen/paths.ts).

### 2.1 BFF proxy, authz and audit mapping

[`auth/src/proxy.ts`](../auth/src/proxy.ts) proxies `/api/*` to oxen-server, rejects unclassifiable non-GET bodies, authorizes, then appends an audit event with `interpretRequest` ([`requestInterpretation.ts`](../auth/src/requestInterpretation.ts)). Role mapping lives in [`authzPathMap.ts`](../auth/src/authzPathMap.ts) and the `minRole` from `interpretRequest`.

| Oxen route | Audit action | Min repo role |
| --- | --- | --- |
| `GET/HEAD /api/version` | — (public) | none |
| `GET /api/namespaces`, `GET /api/repos/:ns[/:repo/**]` | — | `read` |
| `POST /api/repos` | `repo.create` | `write` (plus namespace-level create check, `authz.ts`) |
| `PUT .../file/**`, `DELETE` file | `file.write` / `file.delete` | `write` |
| `POST .../branches`; `PUT/PATCH .../branches/**` | `branch.create` / `branch.update` | `write` |
| `DELETE .../branches/**` | `branch.delete` | `maintain` |
| `POST .../merge*` (branch merge, commit-into-branch) | `merge` | `maintain` |
| `DELETE /api/repos/:ns/:repo` | `repo.delete` | `admin` |
| `PATCH/PUT` repo root, `settings`, `meta` | `repo.metadata` | `admin` |
| `POST .../rename`, `POST .../transfer` | `other` (no dedicated action) | `admin` via the unknown-mutating fallback |
| `POST /api/namespaces` | `namespace.create` | namespace-level check |

Namespace create/delete/settings/membership are audited from the AuthZ endpoints in [`auth/src/index.ts`](../auth/src/index.ts) (`namespace.create`, `namespace.settings.update`, `namespace.delete`, `namespace.member.*`); labels in [`auditLabels.ts`](../auth/src/auditLabels.ts).

### 2.2 CLI and e2e

- CLI: [`cli/lib/oxen.mjs`](../cli/lib/oxen.mjs) wraps the `oxen` binary (clone detection, add/commit/fetch/push/merge/checkout, BFF URL rewriting); not a repo/namespace admin tool — see [07-cli.md](./07-cli.md).
- E2E specs under [`e2e/tests/`](../e2e/tests/) that touch this epic: `smoke`, `nav`, `branches-commits`, `branches-advanced`, `blob-tree-recent`, `files-advanced`, `compare-advanced` (incl. DF compare/DF paging), `merge-conflicts`, `repo-manage`, `authz`, `audit`, `action-icons`, `hub-ui-chrome`.
- Not found: a dedicated spec for namespace create/settings/delete (only referenced from `authz.spec.ts` and `action-icons.spec.ts`), repo create form, repository list pagination, or merge success path.

## 3. Goals & non-goals

### Goals

1. Document and protect the shipped browse/lifecycle behavior with a stable test matrix
2. Close audit/authz classification gaps for repo rename/transfer
3. Decide which browsing gaps (§7) deserve epics of their own

### Non-goals

- Forking oxen-server for features it lacks (tags, protection) unless an ADR approves
- Replacing oxen merge semantics with a PR product (see open questions)

## 4. Phased checklist

### Phase 0 — Shipped baseline

- [x] Namespace list/search/pagination, create, home card, settings, cascade delete
- [x] Repo list/search/pagination, create, settings (collaborators), delete with confirmation
- [x] Repo transfer to another namespace (UI + e2e R-06)
- [x] Repo rename UI wired to `.../rename` (oxen OSS refuses; e2e R-05 asserts the error message)
- [x] Tree browse, rename/move/copy, delete, deleted-file restore
- [x] Blob preview (text, image), details, metadata, history, lineage tabs
- [x] Branch list/create/delete/repoint; default-branch delete blocked in UI
- [x] Commit history (per revision/path) and all-commits mode; commit detail and parents
- [x] Compare commits/entries/file diff
- [x] Merge page with mergeability preview and conflict list; merge disabled on conflicts
- [x] DataFrame viewing with server paging; DF compare create/reload/delete; schema/column metadata staging
- [x] BFF role mapping (`read`/`write`/`maintain`/`admin`) and audit classification for repo/branch/merge/file routes

### Phase 1 — Hardening the baseline (proposed, not approved)

- [ ] Add dedicated `repo.rename` / `repo.transfer` audit actions and explicit authz mapping in `classifyPath`, `authzPathMap.ts` and `auditLabels.ts` (proposed, not approved)
- [ ] Clarify rename UX: hide or disable Rename when the server reports it is unsupported rather than failing after submit (proposed, not approved)
- [ ] Add e2e for namespace create/delete, repo create form, merge success, list pagination (proposed, not approved)
- [ ] Verify what a transfer does to AuthZ memberships, favorites, metadata and lineage keyed by `namespace/repo` (proposed, not approved)

### Phase 2 — Browsing at scale (proposed, not approved)

- [ ] Paginate or virtualize commits list and tree directory listings (current pages fetch via `listAllCommits` / single `listDirectory` call; no paging controls found in `CommitsPage`/`TreePage`) (proposed, not approved)
- [ ] Large-file preview guardrails: `BlobPage` downloads full text/image into the browser with no size cap found; add size limit and "download instead" (proposed, not approved)
- [ ] Per-path blame / richer file history (history tab lists versions only) (proposed, not approved)
- [ ] Additional preview types (CSV/parquet via DataFrame handoff, PDF, markdown rendering) (proposed, not approved)

### Phase 3 — Repository governance (proposed, not approved)

- [ ] Archive / read-only repository state (proposed, not approved)
- [ ] Tags / named releases pinning a commit — would also serve job/session version pins (proposed, not approved)
- [ ] Branch protection (restrict merge/delete/force-update beyond role) (proposed, not approved)
- [ ] Review-before-merge workflow with GxP e-signature hook — see [04-gxp-compliance.md](./04-gxp-compliance.md) (proposed, not approved)
- [ ] Search handoff: repo/path/commit hits from [12-metadata-search.md](./12-metadata-search.md) deep-link into tree/blob/commit pages (proposed, not approved)

## 5. Test plan

| ID | Case | Expectation | Coverage |
| --- | --- | --- | --- |
| TC-REPO-01 | Browse tree and open blob | Directory entries listed; blob tabs render | `blob-tree-recent.spec.ts` |
| TC-REPO-02 | Image / text preview | `img` for images, text shown for text | `files-advanced.spec.ts` TC-F-02c |
| TC-REPO-03 | Create/list/delete branch; delete main blocked | UI blocks default branch | `branches-commits.spec.ts` B-01–B-05 |
| TC-REPO-04 | Repoint branch / merge commit into branch | Branch tip changes | `branches-advanced.spec.ts` B-04, B-06 |
| TC-REPO-05 | Commits list, path filter, detail, parents | As listed | `branches-commits.spec.ts` C-01–C-05; `branches-advanced.spec.ts` C-04 |
| TC-REPO-06 | Compare branches/path/file diff | Commits and entries shown | `branches-commits.spec.ts` D-01/D-02; `compare-advanced.spec.ts` D-03/D-04 |
| TC-REPO-07 | Conflicting merge | Conflicts shown, merge blocked | `merge-conflicts.spec.ts` M-03 |
| TC-REPO-08 | Clean merge succeeds and audit `merge` event written | Merge ids shown; audit row | Not covered |
| TC-REPO-09 | DataFrame page, paging, index | Next/Previous work | `compare-advanced.spec.ts` DF-01/02, TC-DF-01b |
| TC-REPO-10 | DF compare create/reload/delete | Rows paged | `compare-advanced.spec.ts` D-05–D-07 |
| TC-REPO-11 | Repo transfer | Lands in target namespace | `repo-manage.spec.ts` R-06 |
| TC-REPO-12 | Repo rename on OSS | Clear refusal message | `repo-manage.spec.ts` R-05 |
| TC-REPO-13 | Size and stats on overview | Displayed | `repo-manage.spec.ts` R-07–R-09 |
| TC-REPO-14 | Role gates: `read` cannot merge/delete branch; `write` cannot merge; `maintain` cannot delete repo | `403` | Partly `authz.spec.ts` (verify per role) |
| TC-REPO-15 | Namespace create/delete, repo create | Covered by new specs | Not covered |
| TC-REPO-16 | Rename/transfer produce dedicated audit actions | Only after Phase 1 | Not covered |

## 6. Open questions

1. Is Merge page + role `maintain` the intended review gate, or does the platform need PR-like review (proposed in Phase 3)?
2. Rename is unsupported on stock oxen-server; keep the control, hide it, or implement rename as copy+delete at the BFF?
3. Should transfer be restricted beyond repo `admin` (e.g. require destination namespace `write`)? Not verified in code.
4. Where should tags live: oxen-server (if supported) or a BFF store?
5. What size/row ceilings for preview and listings do GxP users expect?

## 7. Risks

| Risk | Mitigation |
| --- | --- |
| `rename`/`transfer` classified as `other` — audit trail lacks a precise action and notification mapping | Phase 1 dedicated actions |
| Unbounded history/tree/blob loads degrade the SPA on large repos | Phase 2 paging and preview caps |
| New oxen routes unclassified in `classifyPath` default to `admin` for mutations (safe) but read-only routes default to `read` | Review `authzPathMap.ts` when upgrading oxen-server |
| Transfer/delete orphan platform data keyed by `namespace/repo` (AuthZ, favorites, meta, lineage) | Verify cascade behavior (Phase 1) |
| Drift between `authzPathMap.ts` and `requiredRepoRoleForRequest` (comment says keep in sync) | Add a unit test comparing them |

## 8. How to use this file

1. Implement one phase at a time; tick bullets in PRs. Items marked "proposed, not approved" need owner sign-off first.
2. When PLAT-REPO is added to [EPICS.md](./EPICS.md), link back here and mirror Status.
