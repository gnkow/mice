# FEATURES — Boxen × GitHub × Oxen parity matrix

Living evaluation backlog for progressive implementation. Boxen is a Vite/React UI for self-hosted [`oxen-server`](https://docs.oxen.ai/getting-started/oxen-server). This matrix tracks:

1. **Track A** — Oxen / `oxen-server` UI coverage (grounded in current routes and Playwright IDs under `e2e/tests/`)
2. **Track B** — Full GitHub.com product + UI parity (including surfaces that need a new backend beyond `oxen-server`)

Update a row when status changes. Prefer flipping one atomic row at a time.

## Legend

| Column | Values |
| --- | --- |
| **Exists in Boxen** | `Yes` / `Partial` / `No` / `N/A` |
| **Exists in Github** | `Yes` / `Partial` / `No` / `N/A` |
| **Remaining work/TODO** | Next concrete slice; end with a backend tag |

**Backend tags** (append to TODO):

| Tag | Meaning |
| --- | --- |
| `UI-only` | Chrome / layout / styling; API already sufficient or not required |
| `oxen-server` | Needs or already uses self-hosted Oxen HTTP API |
| `new backend` | Needs platform services beyond oxen-server (auth, PRs, Issues, Actions, …) |
| `hub-only / out of scope` | Oxen Hub cloud surface; not a goal for OSS Boxen + oxen-server |

**Feature ID prefixes:** `P` platform, `N` namespace, `R` repo, `F` files, `L` large upload, `B` branches, `C` commits, `D` compare, `M` merge, `W` workspaces, `DF` data frames, `GH-*` GitHub parity (product backlog), `UI-*` Oxen Hub look + IA chrome, `OX-*` Oxen Hub / differentiators.

## Concept map

| Boxen / Oxen | Closest GitHub analogue |
| --- | --- |
| Namespace | Organization (or user) |
| Repository | Repository |
| Tree / Blob | Code tab (files / file view) |
| Branch / Commit | Branch / Commit |
| Compare + Merge pages | Compare view + merge (without a Pull Request object) |
| Workspace | Remote staging / working tree (closer than a PR) |
| Data frame | No direct equivalent (tabular dataset first-class) |
| Bearer token in Settings | PAT (no login/SSO UI yet) |

## Priority bands (progressive implementation)

| Band | Focus |
| --- | --- |
| **P0** | Oxen Hub look + IA (`UI-*` retargeted): tokens, topbar/drawer, Data/Branches/Merge nav, Projects home — without hub-only backends |
| **P1** | Auth/identity, Pull Requests, Issues, notifications, search |
| **P2** | Actions/CI, Packages, Releases, Security/Dependabot |
| **P3** | Enterprise admin, Copilot/Codespaces, Marketplace, Sponsors, Mobile/Desktop |

## Summary scoreboard (snapshot at authoring)

Counts are approximate; recompute when large batches of rows flip.

| Area | Rows | Boxen Yes | Boxen Partial | Boxen No |
| --- | --- | --- | --- | --- |
| 1. Platform & connection | 10 | 8 | 2 | 0 |
| 2. Namespaces / orgs | 14 | 3 | 1 | 10 |
| 3. Repositories | 22 | 7 | 2 | 13 |
| 4. Code / files | 28 | 20 | 2 | 6 |
| 5. Branches & commits | 22 | 12 | 1 | 9 |
| 6. Compare & merge | 16 | 9 | 2 | 5 |
| 7. Workspaces | 14 | 13 | 1 | 0 |
| 8. Data frames | 10 | 10 | 0 | 0 |
| 9. Pull requests & review | 28 | 0 | 0 | 28 |
| 10. Issues & planning | 22 | 0 | 0 | 22 |
| 11. Wiki / Pages / Docs | 10 | 0 | 0 | 10 |
| 12. Releases & packages | 12 | 0 | 0 | 12 |
| 13. Actions / CI | 18 | 0 | 0 | 18 |
| 14. Security | 18 | 0 | 0 | 18 |
| 15. Search & navigation | 12 | 1 | 1 | 10 |
| 16. Social & discovery | 14 | 0 | 0 | 14 |
| 17. Auth & permissions | 22 | 1 | 1 | 20 |
| 18. Notifications & activity | 10 | 0 | 0 | 10 |
| 19. Oxen Hub look + IA | 24 | 20 | 3 | 1 |
| 20. Developer platform | 14 | 0 | 1 | 13 |
| 21. Cloud / AI | 12 | 0 | 0 | 12 |
| 22. Enterprise admin | 14 | 0 | 0 | 14 |
| 23. Hub-only & Oxen extras | 10 | 0 | 0 | 10 (OOS / differentiator) |
| **Approx. total** | **~376** | **~84** | **~17** | **~275** |

---

## 1. Platform & connection

| ID | Feature | Exists in Boxen | Exists in Github | Remaining work/TODO |
| --- | --- | --- | --- | --- |
| P-01 | Home / projects list loads against live server | Yes | Yes | Hub-like Projects home; keep storage meter — UI-only |
| P-02 | Settings: probe `/api/version` (Test connection) | Yes | Partial | GitHub has status elsewhere; keep Oxen probe; style Settings like GitHub — UI-only |
| P-03 | Bearer token from Settings sent as `Authorization` | Yes | Yes | Map UX to PAT management page — new backend + UI-only |
| P-04 | Bad API base / offline banner | Yes | Partial | GitHub has global status; polish banner to Primer Alert — UI-only |
| P-04b | Empty namespaces empty-state copy | Yes | Yes | Align empty-state illustration/copy with GitHub — UI-only |
| P-04c | Home loading then namespace list | Yes | Yes | Skeleton loaders like GitHub — UI-only |
| SET-01 | Commit author name/email in Settings used on commit/merge | Yes | Partial | GitHub uses signed-in user; keep local author until accounts — new backend |
| SET-02 | Configurable API base URL | Yes | N/A | Self-host only; document clearly — UI-only |
| SET-03 | Persist settings in `localStorage` | Yes | Partial | Move secrets to secure session when auth lands — new backend |
| GH-PLAT-01 | Signed-in user avatar / account menu | Partial | Yes | Account details menu exists → Settings only; add profile/avatar — new backend |

---

## 2. Namespaces / organizations

| ID | Feature | Exists in Boxen | Exists in Github | Remaining work/TODO |
| --- | --- | --- | --- | --- |
| N-01 | Create namespace (implicit with repo create) | Yes | Yes | Explicit “New organization” flow — oxen-server + UI-only |
| N-02 | Open namespace page with repo list | Yes | Yes | Clone org overview (avatar, description, tabs) — UI-only |
| N-03 | Namespace storage usage | Yes | Partial | GitHub billing/insights; keep Oxen size; present as org Insights — UI-only |
| GH-ORG-01 | Organization profile (avatar, bio, URL, location) | No | Yes | Org metadata model + settings UI — new backend |
| GH-ORG-02 | Organization members list | No | Yes | Membership API + Members tab — new backend |
| GH-ORG-03 | Organization teams | No | Yes | Teams CRUD + nested teams — new backend |
| GH-ORG-04 | Team repositories & permissions | No | Yes | Team↔repo ACL — new backend |
| GH-ORG-05 | Outside collaborators | No | Yes | Collaborator invites — new backend |
| GH-ORG-06 | Org-level Projects tab | No | Yes | See §10 — new backend |
| GH-ORG-07 | Org-level Packages / Sponsoring | No | Yes | See §12 / §16 — new backend |
| GH-ORG-08 | Org settings (Member privileges, Moderation) | No | Yes | Settings IA clone — new backend |
| GH-ORG-09 | Verified domains | No | Yes | Domain verification flow — new backend |
| GH-ORG-10 | Org security overview | No | Yes | Depends on §14 — new backend |
| GH-ORG-11 | People / Invitations UI | No | Yes | Invite email + pending list — new backend |

---

## 3. Repositories

| ID | Feature | Exists in Boxen | Exists in Github | Remaining work/TODO |
| --- | --- | --- | --- | --- |
| R-01 | List repositories on namespace page | Yes | Yes | Repo list row chrome (language, updated, stars) — UI-only / new backend for stars |
| R-02 | Create repository (namespace, name, description) | Yes | Yes | Add visibility, .gitignore, license, README init like GitHub New repo — oxen-server + UI-only |
| R-03 | Open repository → tree (default branch) | Yes | Yes | Remember default branch; GitHub-like repo header — UI-only |
| R-04 | Delete repository (danger confirm) | Yes | Yes | Match GitHub Danger Zone typed confirm — UI-only |
| R-05 | Rename repository | Partial | Yes | OSS name-addressed server refuses; Hub/UUID path or server support — oxen-server |
| R-06 | Transfer repository to another namespace | Yes | Yes | Match Transfer ownership modal — UI-only |
| R-07 | Repository size on overview | Yes | Partial | Present under Insights → Traffic/Storage — UI-only |
| R-08 | Repository stats on overview | Yes | Yes | Chart sparklines optional later — UI-only |
| R-09 | Update / refresh computed size | Yes | No | Keep Oxen action; no GitHub twin — oxen-server |
| GH-REPO-01 | Public / private / internal visibility | No | Yes | Visibility flags + ACL — new backend |
| GH-REPO-02 | Repository topics / tags | No | Yes | Topics edit UI — new backend |
| GH-REPO-03 | About sidebar (description, website, topics) | Partial | Yes | Aside exists with stats; add website/topics — UI-only + new backend |
| GH-REPO-04 | Fork repository | No | Yes | Fork model + network graph — new backend |
| GH-REPO-05 | Star / unstar | No | Yes | Stars counter + API — new backend |
| GH-REPO-06 | Watch / custom notifications | No | Yes | Watch menu — new backend |
| GH-REPO-07 | Archive / unarchive | No | Yes | Read-only archive state — new backend |
| GH-REPO-08 | Template repository + Use this template | No | Yes | Template flag + generate — new backend |
| GH-REPO-09 | Repository settings pages (General, Collaborators, …) | Partial | Yes | Manage aside only; full settings nav — new backend + UI-only |
| GH-REPO-10 | Default branch setting | Partial | Yes | Create uses `main`; settings control — oxen-server + UI-only |
| GH-REPO-11 | Social preview image | No | Yes | Open Graph image upload — new backend |
| GH-REPO-12 | .github community health files surfaced | No | Yes | Detect CONTRIBUTING, CODE_OF_CONDUCT — UI-only |
| GH-REPO-13 | Repo Insights (Pulse, Contributors, Commits, Code frequency, Dependency graph, Network, Forks) | No | Yes | Insights tabs; reuse commit APIs where possible — UI-only + new backend |

---

## 4. Code / files UI

| ID | Feature | Exists in Boxen | Exists in Github | Remaining work/TODO |
| --- | --- | --- | --- | --- |
| F-01 | Browse repository tree at branch/path | Yes | Yes | — |
| F-02 | Open blob / file view | Yes | Yes | Blame link still needs history derivation — oxen-server + UI-only |
| F-02b | Download file from blob | Yes | Yes | Raw + Download buttons like GitHub — UI-only |
| F-02c | Image preview in blob | Yes | Yes | Zoom / lightbox polish — UI-only |
| F-03 | Path breadcrumbs + navigate directories | Yes | Yes | — |
| F-04 | Delete file | Yes | Yes | Commit message modal for delete — oxen-server + UI-only |
| F-04b | Delete directory | Yes | Partial | GitHub deletes via PR/commit; keep Oxen dir delete — oxen-server |
| F-05 | Move / rename file | Yes | Yes | Commit-style rename UX — UI-only |
| F-06 | Blob metadata display | Yes | Yes | Size, hash, MIME like GitHub file header — UI-only |
| F-07 | Refresh file metadata | Yes | No | Keep Oxen-specific action — oxen-server |
| F-08 | Export path / repo as zip | Yes | Yes | Align with “Download ZIP” — UI-only |
| F-09 | Import from URL | Yes | Partial | GitHub has importer; keep Oxen import — oxen-server |
| F-10 | Upload & unpack zip archive | Yes | Partial | Web upload exists on GitHub for files; zip unpack is Oxen — oxen-server |
| F-11 | Download by content hash | Yes | No | Version-store affordance — oxen-server |
| F-12 | Version-store download from blob | Yes | Partial | Similar to LFS pointer download — oxen-server |
| F-13 | Multi-file large upload entry | Yes | Partial | GitHub upload is simpler; keep chunked Oxen path — oxen-server |
| F-14 | Download versions tarball by hashes | Yes | No | Batch version export — oxen-server |
| F-15 | File version history at path | Yes | Yes | History button → commits for path (GitHub History) — UI-only |
| F-16 | Download via version store control | Yes | Partial | Label consistently — UI-only |
| L-01 | Chunked large-file upload (XXH3) | Yes | Partial | GitHub LFS is different protocol; keep Oxen chunked API — oxen-server |
| L-02 | Large upload staged into workspace | Yes | No | Workspace staging after upload — oxen-server |
| GH-CODE-01 | Inline blame view | No | Yes | Blame API or derive from history — oxen-server + UI-only |
| GH-CODE-02 | Raw file view route | Partial | Yes | Dedicated `/raw` style link — UI-only |
| GH-CODE-03 | Edit file in browser (commit from UI) | Partial | Yes | Upload/workspace cover edit; add pencil editor + commit — oxen-server + UI-only |
| GH-CODE-04 | Create new file in browser | No | Yes | New file editor — oxen-server + UI-only |
| GH-CODE-05 | Syntax highlighting for common languages | Partial | Yes | Text preview only; add highlighter — UI-only |
| GH-CODE-06 | Permalink to line (`#L`) | No | Yes | Line anchors + copy permalink — UI-only |
| GH-CODE-07 | Code owners overlay / OWNERS hints | No | Yes | Parse CODEOWNERS — new backend + UI-only |
| GH-CODE-08 | Go to file (t) fuzzy finder | No | Yes | Client-side path index — UI-only |

---

## 5. Branches & commits

| ID | Feature | Exists in Boxen | Exists in Github | Remaining work/TODO |
| --- | --- | --- | --- | --- |
| B-01 | List branches | Yes | Yes | Ahead/behind vs default like GitHub — oxen-server + UI-only |
| B-02 | Create branch | Yes | Yes | Branch from branch/tag/commit picker — UI-only |
| B-03 | Show branch tip / HEAD commit | Yes | Yes | Tip SHA in list — UI-only |
| B-04 | Point branch tip at commit | Yes | Partial | Force-update tip (advanced); GitHub uses reset/PR — oxen-server |
| B-05 | Delete branch (block default/main) | Yes | Yes | Match GitHub delete + restore messaging — UI-only |
| B-06 | Merge commit into branch (push path) | Yes | Partial | Advanced Oxen path; prefer PR merge UX later — oxen-server |
| C-01 | Commits list for branch | Yes | Yes | Avatars are initials until accounts exist — new backend |
| C-02 | Filter commits by path | Yes | Yes | Path history chrome — UI-only |
| C-03 | Commit detail page | Yes | Yes | Files changed + diff tabs like GitHub commit — UI-only |
| C-04 | Commit parents / ancestry | Yes | Yes | Parent links in header — UI-only |
| C-05 | Root commit link | Yes | Partial | Keep Oxen helper — oxen-server |
| C-06 | Commits included in compare | Yes | Yes | Shared with compare page — UI-only |
| GH-BR-01 | Protected branches | No | Yes | Protection rules engine — new backend |
| GH-BR-02 | Repository rulesets | No | Yes | Rulesets UI + enforcement — new backend |
| GH-BR-03 | Branch naming patterns | No | Yes | Part of rulesets — new backend |
| GH-BR-04 | Tags list + annotated tags | No | Yes | Tag API + Releases linkage — oxen-server + new backend |
| GH-BR-05 | Signed commits verification badge | No | Yes | GPG/SSH sig verify — new backend |
| GH-BR-06 | Commit status checks on commit page | No | Yes | Depends on Actions/checks — new backend |
| GH-BR-07 | Compare branches dropdown on Branches page | Partial | Yes | Links to compare exist; polish to GitHub — UI-only |
| GH-BR-08 | Default branch badge | Partial | Yes | Explicit “default” label — UI-only |
| GH-BR-09 | Stale branch cleanup suggestions | No | Yes | Heuristics + UI — UI-only |
| GH-BR-10 | Commit listing “Browse files” at revision | Yes | Yes | Already link to tree; match button placement — UI-only |

---

## 6. Compare & merge

| ID | Feature | Exists in Boxen | Exists in Github | Remaining work/TODO |
| --- | --- | --- | --- | --- |
| D-01 | Compare two refs: commits list | Yes | Yes | — |
| D-02 | Compare entries / file list | Yes | Yes | — |
| D-03 | Path filter on compare | Yes | Partial | Keep; GitHub uses file filter — UI-only |
| D-04 | Per-file diff view | Yes | Yes | Split/unified toggle, expand context — UI-only |
| D-05 | Data-frame compare create | Yes | No | Oxen tabular compare — oxen-server |
| D-06 | DF compare reload + paginated rows | Yes | No | — oxen-server |
| D-07 | DF compare delete | Yes | No | — oxen-server |
| M-01 | Mergeability check base←head | Yes | Yes | Surface as PR merge box later — UI-only + new backend |
| M-02 | Execute merge head→base | Yes | Yes | Merge method picker (merge/squash/rebase) — oxen-server + new backend |
| M-03 | Conflict reporting on merge | Yes | Yes | Inline conflict editor — UI-only + oxen-server |
| GH-CMP-01 | Three-dot range vs two-dot | Partial | Yes | Explicit range syntax in UI — UI-only |
| GH-CMP-02 | Create pull request CTA from compare | No | Yes | Wire to GH-PR-* — new backend |
| GH-CMP-03 | Rich diff (images, notebooks, Prose) | Partial | Yes | Image/text only; add renderers — UI-only |
| GH-CMP-04 | Reviewable comment draft on lines (without PR) | No | Yes | Requires review model — new backend |
| GH-CMP-05 | Dir tree compare visualization | Yes | Partial | Oxen dir_tree; style as GitHub file tree — UI-only |
| GH-CMP-06 | Merge queue | No | Yes | Queue service — new backend |

---

## 7. Workspaces (Oxen-first)

| ID | Feature | Exists in Boxen | Exists in Github | Remaining work/TODO |
| --- | --- | --- | --- | --- |
| W-01 | List workspaces | Yes | N/A | Present as “Workspace” nav; optional map to draft changes — UI-only |
| W-02 | Create workspace | Yes | N/A | From branch picker like Codespaces create — oxen-server + UI-only |
| W-03 | Workspace detail (staged changes) | Yes | Partial | Similar to PR files / git status — UI-only |
| W-04 | Filter staged changes | Yes | Yes | — UI-only |
| W-05 | Workspace mergeability vs branch | Yes | Partial | — oxen-server |
| W-06 | Unstage change | Yes | Partial | — oxen-server |
| W-07 | Delete workspace | Yes | N/A | — oxen-server |
| W-08 | Preview staged file | Yes | Yes | Diff preview chrome — UI-only |
| W-09 | Stage file upload into workspace | Yes | Partial | — oxen-server |
| W-10 | Stage file removal | Yes | Partial | — oxen-server |
| W-11 | Workspace changes add/mod/remove types | Yes | Yes | Icons like GitHub files changed — UI-only |
| W-12 | Clear all workspaces (client loop) | Partial | N/A | Server bulk clear if added — oxen-server |
| W-13 | Commit / merge workspace to branch | Yes | Partial | Closest to committing from web editor — oxen-server |
| GH-WS-MAP | Document Workspace vs PR vs Codespaces in UI help | No | N/A | Help callout on Workspaces page — UI-only |

---

## 8. Data frames (Boxen / Oxen differentiator)

| ID | Feature | Exists in Boxen | Exists in Github | Remaining work/TODO |
| --- | --- | --- | --- | --- |
| DF-01 | Data frame table slice viewer | Yes | No | Keep differentiator; polish grid UX — oxen-server + UI-only |
| DF-01b | DF pagination next/previous | Yes | No | — oxen-server |
| DF-02 | Index data frame for query | Yes | No | — oxen-server |
| DF-03 | Create DF listing from directory | Yes | No | — oxen-server |
| DF-04 | Stage schema metadata via workspace | Yes | No | — oxen-server |
| DF-05 | Stage column metadata via workspace | Yes | No | — oxen-server |
| DF-06 | Open tabular blob as table | Yes | No | Detect CSV/Parquet CTA — UI-only |
| DF-07 | Link DF page ↔ raw blob | Yes | No | — UI-only |
| DF-08 | DF compare entry from repo nav | Yes | No | — UI-only |
| DF-09 | Query / filter rows in DF UI | Partial | No | Expand beyond pagination if API allows — oxen-server |

---

## 9. Pull requests & code review

| ID | Feature | Exists in Boxen | Exists in Github | Remaining work/TODO |
| --- | --- | --- | --- | --- |
| GH-PR-01 | Pull requests list (`/pulls`) | No | Yes | PR entity + list UI clone — new backend |
| GH-PR-02 | Pull request detail conversation | No | Yes | Timeline + markdown — new backend |
| GH-PR-03 | Files changed tab | No | Yes | Reuse compare diff components — new backend + UI-only |
| GH-PR-04 | Commits tab on PR | No | Yes | — new backend |
| GH-PR-05 | Checks / Actions tab on PR | No | Yes | Depends on §13 — new backend |
| GH-PR-06 | Create PR from compare / branch | No | Yes | — new backend |
| GH-PR-07 | Draft pull requests | No | Yes | Draft state flag — new backend |
| GH-PR-08 | Request reviewers | No | Yes | — new backend |
| GH-PR-09 | Review approve / comment / request changes | No | Yes | Review model — new backend |
| GH-PR-10 | Inline line comments + suggested changes | No | Yes | Diff annotation UI — new backend + UI-only |
| GH-PR-11 | Resolve conversation threads | No | Yes | — new backend |
| GH-PR-12 | CODEOWNERS auto-request | No | Yes | — new backend |
| GH-PR-13 | Required reviewers / approvals | No | Yes | Branch protection — new backend |
| GH-PR-14 | Merge button (merge / squash / rebase) | No | Yes | Wrap M-02 in PR box — new backend + oxen-server |
| GH-PR-15 | Auto-merge | No | Yes | — new backend |
| GH-PR-16 | Merge queue enrollment | No | Yes | — new backend |
| GH-PR-17 | PR templates | No | Yes | `.github/PULL_REQUEST_TEMPLATE` — UI-only + new backend |
| GH-PR-18 | Linked issues / closing keywords | No | Yes | — new backend |
| GH-PR-19 | Reviewers & assignees sidebar | No | Yes | — new backend |
| GH-PR-20 | Labels / milestone / projects on PR | No | Yes | — new backend |
| GH-PR-21 | Force-push warning & commit rewrites | No | Yes | — new backend |
| GH-PR-22 | Re-request review | No | Yes | — new backend |
| GH-PR-23 | Copilot / AI PR summary (see also §21) | No | Yes | — new backend |
| GH-PR-24 | Stacked / dependent PRs | No | Partial | Optional later — new backend |
| GH-PR-25 | PR blame / view at PR head | No | Yes | — UI-only + new backend |
| GH-PR-26 | Sticky file tree on Files changed | No | Yes | — UI-only |
| GH-PR-27 | Review submissions batch | No | Yes | — new backend |
| GH-PR-28 | Cross-repo / fork PRs | No | Yes | Needs forks — new backend |

---

## 10. Issues & planning

| ID | Feature | Exists in Boxen | Exists in Github | Remaining work/TODO |
| --- | --- | --- | --- | --- |
| GH-ISS-01 | Issues list | No | Yes | Issue entity + `/issues` UI — new backend |
| GH-ISS-02 | Issue detail (markdown body, timeline) | No | Yes | — new backend |
| GH-ISS-03 | Create / edit / close / reopen issue | No | Yes | — new backend |
| GH-ISS-04 | Labels CRUD | No | Yes | — new backend |
| GH-ISS-05 | Milestones | No | Yes | — new backend |
| GH-ISS-06 | Assignees | No | Yes | — new backend |
| GH-ISS-07 | Issue templates / forms | No | Yes | — new backend |
| GH-ISS-08 | Task lists / sub-issues | No | Yes | — new backend |
| GH-ISS-09 | Issue types (bug/feature/…) | No | Yes | — new backend |
| GH-ISS-10 | Cross-references & auto-close via PR | No | Yes | — new backend |
| GH-ISS-11 | Saved replies | No | Yes | — new backend |
| GH-ISS-12 | Discussions (Q&A, polls) | No | Yes | Discussions app — new backend |
| GH-ISS-13 | Projects (classic boards) | No | Yes | Optional; prefer v2 — new backend |
| GH-ISS-14 | Projects v2 (tables, boards, roadmaps) | No | Yes | Projects service — new backend |
| GH-ISS-15 | Project fields, views, insights | No | Yes | — new backend |
| GH-ISS-16 | Org-level issue search | No | Yes | — new backend |
| GH-ISS-17 | Transfer issue between repos | No | Yes | — new backend |
| GH-ISS-18 | Pin issues | No | Yes | — new backend |
| GH-ISS-19 | Duplicate issue detection / mark | No | Yes | — new backend |
| GH-ISS-20 | Community insights / pulse | No | Yes | — new backend |
| GH-ISS-21 | Slash commands in comments | No | Yes | — new backend |
| GH-ISS-22 | Reactions on issues/comments | No | Yes | — new backend |

---

## 11. Wiki / Pages / Docs

| ID | Feature | Exists in Boxen | Exists in Github | Remaining work/TODO |
| --- | --- | --- | --- | --- |
| GH-DOC-01 | Repository Wiki | No | Yes | Wiki git repo + editor — new backend |
| GH-DOC-02 | Wiki pages sidebar / search | No | Yes | — new backend |
| GH-DOC-03 | GitHub Pages site | No | Yes | Static hosting pipeline — new backend |
| GH-DOC-04 | Pages custom domain + HTTPS | No | Yes | — new backend |
| GH-DOC-05 | Docs as Code (docs/ folder rendering) | No | Partial | Soft doc site from tree — UI-only |
| GH-DOC-06 | README rendering on repo home | Partial | Yes | Tree shows files; pin README below tree like GitHub — UI-only |
| GH-DOC-07 | LICENSE / CITATION rendering | No | Yes | Detect + pretty view — UI-only |
| GH-DOC-08 | Mermaid / math in markdown | No | Yes | Markdown pipeline — UI-only |
| GH-DOC-09 | HTML sanitization for user content | No | Yes | Shared markdown renderer — UI-only |
| GH-DOC-10 | Profile README (user/org) | No | Yes | Needs profiles — new backend |

---

## 12. Releases & packages

| ID | Feature | Exists in Boxen | Exists in Github | Remaining work/TODO |
| --- | --- | --- | --- | --- |
| GH-REL-01 | Releases list | No | Yes | Release entity tied to tags — new backend |
| GH-REL-02 | Create release + notes | No | Yes | — new backend |
| GH-REL-03 | Release assets upload | No | Yes | — new backend |
| GH-REL-04 | Latest release badge / API | No | Yes | — new backend |
| GH-REL-05 | Auto-generated release notes | No | Yes | — new backend |
| GH-REL-06 | Pre-release / draft releases | No | Yes | — new backend |
| GH-PKG-01 | GitHub Packages (npm, Maven, NuGet, RubyGems) | No | Yes | Package registry — new backend |
| GH-PKG-02 | Container registry (GHCR) | No | Yes | — new backend |
| GH-PKG-03 | Package permissions & delete | No | Yes | — new backend |
| GH-PKG-04 | Link package to repo | No | Yes | — new backend |
| GH-PKG-05 | Package versions UI | No | Yes | — new backend |
| GH-PKG-06 | Attestations on packages/artifacts | No | Yes | — new backend |

---

## 13. CI/CD — Actions

| ID | Feature | Exists in Boxen | Exists in Github | Remaining work/TODO |
| --- | --- | --- | --- | --- |
| GH-ACT-01 | Workflows list (Actions tab) | No | Yes | Workflow engine + UI — new backend |
| GH-ACT-02 | Workflow file editor (`.github/workflows`) | No | Yes | Reuse code editor — UI-only + new backend |
| GH-ACT-03 | Workflow run detail / logs | No | Yes | Log streaming UI — new backend |
| GH-ACT-04 | Job / step visualization | No | Yes | — new backend |
| GH-ACT-05 | Re-run jobs / failed jobs | No | Yes | — new backend |
| GH-ACT-06 | Artifacts download | No | Yes | — new backend |
| GH-ACT-07 | Caches UI | No | Yes | — new backend |
| GH-ACT-08 | Secrets & variables (repo/org/env) | No | Yes | Encrypted secrets store — new backend |
| GH-ACT-09 | Environments + protection rules | No | Yes | — new backend |
| GH-ACT-10 | GitHub-hosted runners metaphor | No | Yes | Runner fleet — new backend |
| GH-ACT-11 | Self-hosted runners registration | No | Yes | — new backend |
| GH-ACT-12 | Workflow templates marketplace | No | Yes | — new backend |
| GH-ACT-13 | Required status checks | No | Yes | Tie to branch protection — new backend |
| GH-ACT-14 | Deployment / Environments UI | No | Yes | — new backend |
| GH-ACT-15 | Concurrent / matrix builds display | No | Yes | — new backend |
| GH-ACT-16 | OIDC / cloud deploy integrations | No | Yes | — new backend |
| GH-ACT-17 | Actions permissions / fork PRs policy | No | Yes | — new backend |
| GH-ACT-18 | Badges for workflow status | No | Yes | SVG badge endpoint — new backend |

---

## 14. Security

| ID | Feature | Exists in Boxen | Exists in Github | Remaining work/TODO |
| --- | --- | --- | --- | --- |
| GH-SEC-01 | Security policy (`SECURITY.md`) | No | Yes | Detect + render — UI-only |
| GH-SEC-02 | Dependency graph | No | Yes | Manifest parsing — new backend |
| GH-SEC-03 | Dependabot alerts | No | Yes | Advisory DB sync — new backend |
| GH-SEC-04 | Dependabot version updates (PRs) | No | Yes | Needs PRs — new backend |
| GH-SEC-05 | Dependency review on PR | No | Yes | — new backend |
| GH-SEC-06 | Secret scanning | No | Yes | Scanner service — new backend |
| GH-SEC-07 | Push protection for secrets | No | Yes | Pre-receive hook — new backend |
| GH-SEC-08 | Code scanning / CodeQL | No | Yes | Analysis runners — new backend |
| GH-SEC-09 | Copilot Autofix for alerts | No | Yes | — new backend |
| GH-SEC-10 | Security advisories (repo) | No | Yes | — new backend |
| GH-SEC-11 | Private vulnerability reporting | No | Yes | — new backend |
| GH-SEC-12 | Security overview (org) | No | Yes | — new backend |
| GH-SEC-13 | Secret risk assessment campaigns | No | Yes | — new backend |
| GH-SEC-14 | Artifact attestations | No | Yes | — new backend |
| GH-SEC-15 | Dependabot malware alerts | No | Yes | — new backend |
| GH-SEC-16 | Code of conduct / reporting | No | Yes | — UI-only + new backend |
| GH-SEC-17 | Security managers role | No | Yes | — new backend |
| GH-SEC-18 | Advisory Database browse | No | Yes | Optional mirror — new backend |

---

## 15. Search & navigation

| ID | Feature | Exists in Boxen | Exists in Github | Remaining work/TODO |
| --- | --- | --- | --- | --- |
| NAV-01 | Repo primary nav (Data, Branches, Merge + More) | Yes | Partial | Hub-like Data/Branches/Merge; Commits/Workspaces/Compare under More — UI-only |
| GH-SEARCH-01 | Global search omnibox | No | Yes | Search service — new backend |
| GH-SEARCH-02 | Code search (regex, filters) | No | Yes | Indexer — new backend |
| GH-SEARCH-03 | Issues / PR search qualifiers | No | Yes | — new backend |
| GH-SEARCH-04 | Command palette (`Ctrl/⌘K`) | No | Yes | Client routes + commands — UI-only |
| GH-SEARCH-05 | Keyboard shortcuts help (`?`) | No | Yes | — UI-only |
| GH-SEARCH-06 | Jump to repo from header search | No | Yes | — new backend |
| GH-SEARCH-07 | Filterable org repo search | Partial | Yes | Client filter on namespace page first — UI-only |
| GH-SEARCH-08 | Advanced search page | No | Yes | — new backend |
| GH-SEARCH-09 | Search result code snippets | No | Yes | — new backend |
| GH-SEARCH-10 | Recent / Jump back | No | Yes | localStorage recents — UI-only |
| GH-SEARCH-11 | Nested file tree browser sidebar | No | Yes | — UI-only |

---

## 16. Social & discovery

| ID | Feature | Exists in Boxen | Exists in Github | Remaining work/TODO |
| --- | --- | --- | --- | --- |
| GH-SOC-01 | Stars | No | Yes | — new backend |
| GH-SOC-02 | Fork network | No | Yes | — new backend |
| GH-SOC-03 | Watchers | No | Yes | — new backend |
| GH-SOC-04 | Trending repositories | No | Yes | — new backend |
| GH-SOC-05 | Explore feed | No | Yes | — new backend |
| GH-SOC-06 | User / org activity feed | No | Yes | — new backend |
| GH-SOC-07 | Follow users | No | Yes | — new backend |
| GH-SOC-08 | GitHub Sponsors | No | Yes | Payments — new backend / out of scope decision |
| GH-SOC-09 | Marketplace (apps/actions) | No | Yes | Catalog — new backend |
| GH-SOC-10 | Gists | No | Yes | Gist service — new backend |
| GH-SOC-11 | Used by / dependency network social proof | No | Yes | — new backend |
| GH-SOC-12 | Repo traffic graphs (clones, views) | No | Yes | Analytics — new backend |
| GH-SOC-13 | Achievements / profile flair | No | Yes | Optional — new backend |
| GH-SOC-14 | Discussions upvotes / answers | No | Yes | With GH-ISS-12 — new backend |

---

## 17. Auth, identity & permissions

| ID | Feature | Exists in Boxen | Exists in Github | Remaining work/TODO |
| --- | --- | --- | --- | --- |
| P-03 | API bearer token (Settings) | Yes | Partial | Elevate to PAT UI with scopes — new backend |
| GH-AUTH-01 | Username / password login | No | Yes | Session auth — new backend |
| GH-AUTH-02 | OAuth apps / login with OIDC | No | Yes | — new backend |
| GH-AUTH-03 | SAML SSO (org/enterprise) | No | Yes | Enterprise IdP — new backend; Oxen Hub SSO is hub-only / out of scope |
| GH-AUTH-04 | SCIM provisioning | No | Yes | — new backend |
| GH-AUTH-05 | Two-factor authentication | No | Yes | — new backend |
| GH-AUTH-06 | Passkeys / security keys | No | Yes | — new backend |
| GH-AUTH-07 | Personal access tokens (fine-grained) | Partial | Yes | Bearer exists; scopes + expiry UI — new backend |
| GH-AUTH-08 | SSH keys for git push/pull | No | Yes | If/when git protocol exposed — new backend |
| GH-AUTH-09 | Deploy keys | No | Yes | — new backend |
| GH-AUTH-10 | Repository collaborators ACL | No | Yes | — new backend |
| GH-AUTH-11 | Team-based permissions | No | Yes | — new backend |
| GH-AUTH-12 | Custom repository roles | No | Yes | — new backend |
| GH-AUTH-13 | CODEOWNERS enforcement | No | Yes | — new backend |
| GH-AUTH-14 | Organization roles (Owner, Member, …) | No | Yes | — new backend |
| GH-AUTH-15 | Enterprise Managed Users | No | Yes | — new backend |
| GH-AUTH-16 | Session management / revoke | No | Yes | — new backend |
| GH-AUTH-17 | Device verification / email verify | No | Yes | — new backend |
| GH-AUTH-18 | Audit of auth events | No | Yes | See §18 — new backend |
| GH-AUTH-19 | IP allow lists | No | Yes | — new backend |
| GH-AUTH-20 | App installation tokens | No | Yes | GitHub Apps — new backend |
| GH-AUTH-21 | User profile page | No | Yes | — new backend |

---

## 18. Notifications & activity

| ID | Feature | Exists in Boxen | Exists in Github | Remaining work/TODO |
| --- | --- | --- | --- | --- |
| GH-NOTIF-01 | Notification inbox | No | Yes | Notification service — new backend |
| GH-NOTIF-02 | Watching / participating filters | No | Yes | — new backend |
| GH-NOTIF-03 | Email notification preferences | No | Yes | — new backend |
| GH-NOTIF-04 | Web / mobile push | No | Yes | — new backend |
| GH-NOTIF-05 | Unsubscribe / Done / Save thread | No | Yes | — new backend |
| GH-NOTIF-06 | @mention notifications | No | Yes | — new backend |
| GH-NOTIF-07 | Scheduled reminders | No | Yes | — new backend |
| GH-NOTIF-08 | News feed / dashboard events | No | Yes | — new backend |
| GH-NOTIF-09 | Audit log (org/enterprise) | No | Yes | Append-only log — new backend |
| GH-NOTIF-10 | Live PR/issue updates | No | Yes | Websockets — new backend |

---

## 19. Oxen Hub look + IA (visual / navigation)

Track visual and information-architecture parity with Oxen Hub for oxen-server-backed surfaces. **Not** a GitHub clone. Hub product surfaces (Models, Generate, Fine-tune, Evaluations, billing) stay in §23 as out of scope.

| ID | Feature | Exists in Boxen | Exists in Github | Remaining work/TODO |
| --- | --- | --- | --- | --- |
| UI-01 | Top bar: hamburger drawer, search, theme, namespace pill, avatar | Yes | Partial | Hub has credits pill — omit billing — UI-only |
| UI-02 | Global footer links | Yes | Yes | — |
| UI-03 | Repo header (owner/name, Local visibility, Star) | Yes | Partial | Star is browser-local; real visibility ACL — new backend |
| UI-04 | Underline repo tabs (Data, Branches, Merge + More) | Yes | Partial | No Issues/PRs/Actions stubs; Hub Generate/Evals OOS — UI-only |
| UI-05 | Oxen Hub color tokens (action purple `#712acc`) + Inter | Yes | N/A | Continue polish radii/shadows — UI-only |
| UI-06 | Pill primary buttons, inputs, dropdowns | Yes | Partial | — UI-only |
| UI-07 | Flash / toast / banner patterns | Yes | Yes | — |
| UI-08 | Modal / confirm dialogs (typed danger) | Yes | Yes | — |
| UI-09 | Empty states (Projects copy) | Yes | Partial | Optional mascot later — UI-only |
| UI-10 | File type icons in tree | Yes | Yes | — |
| UI-11 | Relative timestamps (“3 days ago”) | Yes | Yes | — |
| UI-12 | Markdown rendering (GFM) | Yes | Yes | Subset renderer (no raw HTML) — |
| UI-13 | Emoji shortcodes + reactions UI | Partial | Yes | Shortcodes in markdown; reactions need a backend — new backend |
| UI-14 | User hovercards | No | Yes | — new backend + UI-only |
| UI-15 | Branch switcher dropdown | Yes | Yes | — |
| UI-16 | Data tab README below file list | Yes | Yes | — |
| UI-17 | Sticky local header on scroll | Yes | Yes | — |
| UI-18 | Mobile responsive Hub-like layout | Yes | Yes | — |
| UI-19 | Dark / light / system theme | Yes | Yes | Theme control in topbar |
| UI-20 | Loading skeletons | Yes | Yes | — |
| UI-21 | Diff colorblind-friendly palettes | Yes | Yes | Theme menu → Diff colors |
| UI-22 | Clone URL box (HTTPS / CLI) | Yes | Yes | CLI + HTTPS (oxen remote); SSH not offered by oxen-server |
| UI-23 | Manage Files menu on Data tab | Yes | Partial | Hub Upload/Add folder/Create Dataset; Boxen maps upload/import/export — UI-only |
| UI-24 | Favicon / Boxen wordmark Hub density | Yes | N/A | — |

---

## 20. Developer platform

| ID | Feature | Exists in Boxen | Exists in Github | Remaining work/TODO |
| --- | --- | --- | --- | --- |
| GH-DEV-01 | Public REST API for Boxen resources | Partial | Yes | Oxen REST exists; Boxen-owned resources need API — oxen-server + new backend |
| GH-DEV-02 | GraphQL API | No | Yes | — new backend |
| GH-DEV-03 | Webhooks | No | Yes | Event delivery — new backend |
| GH-DEV-04 | GitHub Apps model | No | Yes | App manifest + installs — new backend |
| GH-DEV-05 | OAuth Apps | No | Yes | — new backend |
| GH-DEV-06 | CLI (`gh`-like) | No | Yes | CLI against APIs — new backend |
| GH-DEV-07 | Desktop app | No | Yes | Optional — new backend |
| GH-DEV-08 | Mobile apps | No | Yes | Optional — new backend |
| GH-DEV-09 | Status / checks API | No | Yes | — new backend |
| GH-DEV-10 | Commit status badges | No | Yes | — new backend |
| GH-DEV-11 | API rate limiting & docs portal | No | Yes | — new backend |
| GH-DEV-12 | Personal access token scopes documented | Partial | Yes | Document bearer until fine-grained PATs — UI-only |
| GH-DEV-13 | Import API (GitHub Importer analogue) | Partial | Yes | Oxen import/export exists — oxen-server |
| GH-DEV-14 | OpenAPI for platform surface | Partial | Yes | Oxen OpenAPI diverges; publish Boxen+Oxen map — UI-only |

---

## 21. Cloud / AI products

| ID | Feature | Exists in Boxen | Exists in Github | Remaining work/TODO |
| --- | --- | --- | --- | --- |
| GH-AI-01 | Codespaces create / list | No | Yes | Cloud dev envs — new backend |
| GH-AI-02 | Codespaces editor in browser | No | Yes | — new backend |
| GH-AI-03 | Devcontainer support | No | Yes | — new backend |
| GH-AI-04 | Copilot code completions | No | Yes | Model proxy — new backend |
| GH-AI-05 | Copilot Chat | No | Yes | — new backend |
| GH-AI-06 | Copilot on PRs (summaries, reviews) | No | Yes | Needs PRs — new backend |
| GH-AI-07 | Copilot Autofix (security) | No | Yes | Needs §14 — new backend |
| GH-AI-08 | Copilot Workspace / agent flows | No | Yes | — new backend |
| GH-AI-09 | Copilot CLI | No | Yes | — new backend |
| GH-AI-10 | Skills / learning paths | No | Yes | Content, not core — new backend |
| GH-AI-11 | Models / inference hosting (GitHub Models analogue) | No | Yes | Distinct from Oxen Hub inference (see §23) — new backend |
| GH-AI-12 | Spark / app prototyping surfaces | No | Yes | Optional P3 — new backend |

---

## 22. Enterprise admin

| ID | Feature | Exists in Boxen | Exists in Github | Remaining work/TODO |
| --- | --- | --- | --- | --- |
| GH-ENT-01 | Enterprise account umbrella | No | Yes | Multi-org admin — new backend |
| GH-ENT-02 | Enterprise policies | No | Yes | — new backend |
| GH-ENT-03 | Enterprise audit log streaming | No | Yes | — new backend |
| GH-ENT-04 | Enterprise Managed Users | No | Yes | — new backend |
| GH-ENT-05 | GitHub Connect analogue | No | Yes | Link to github.com features — new backend |
| GH-ENT-06 | Compliance reports | No | Yes | — new backend |
| GH-ENT-07 | Repository rules organization-wide | No | Yes | — new backend |
| GH-ENT-08 | Internal repositories visibility | No | Yes | — new backend |
| GH-ENT-09 | SCIM at enterprise | No | Yes | — new backend |
| GH-ENT-10 | SAML at enterprise | No | Yes | — new backend |
| GH-ENT-11 | IP allow list enterprise | No | Yes | — new backend |
| GH-ENT-12 | Guest collaborators policies | No | Yes | — new backend |
| GH-ENT-13 | Enterprise Insights / ROI dashboards | No | Yes | — new backend |
| GH-ENT-14 | Self-hosted Enterprise Server parity packing | No | Yes | Packaging/ops docs — new backend |

---

## 23. Hub-only Oxen & out-of-scope / differentiators

Surfaces called out so they are not mistaken for Boxen UX gaps. Option A (Hub look+IA) does **not** implement these product backends.

| ID | Feature | Exists in Boxen | Exists in Github | Remaining work/TODO |
| --- | --- | --- | --- | --- |
| OX-HUB-01 | Oxen Hub SSO | No | N/A | Not for OSS oxen-server — hub-only / out of scope |
| OX-HUB-02 | Oxen Hub inference / Generate / Models UI | No | N/A | — hub-only / out of scope |
| OX-HUB-03 | Oxen Hub fine-tuning UI | No | N/A | — hub-only / out of scope |
| OX-HUB-04 | Oxen Hub billing / usage / credits pill | No | N/A | — hub-only / out of scope |
| OX-HUB-05 | Oxen Hub Evaluations UI | No | N/A | — hub-only / out of scope |
| OX-HUB-06 | Oxen Hub Merge Request objects | No | Partial | Boxen keeps Compare + Merge pages only — hub-only / out of scope |
| OX-DIFF-01 | Data frames as first-class repo data | Yes | No | Maintain as Boxen differentiator — oxen-server |
| OX-DIFF-02 | Data frame compare | Yes | No | — oxen-server |
| OX-DIFF-03 | Workspaces remote staging model | Yes | Partial | Document vs PR/Codespaces — UI-only |
| OX-DIFF-04 | Version store / hash-addressed downloads | Yes | Partial | Similar to LFS; keep Oxen UX — oxen-server |
| OX-DIFF-05 | DF from directory | Yes | No | — oxen-server |
| OX-DIFF-06 | Chunked XXH3 large upload protocol | Yes | Partial | Keep; do not replace with Git LFS unless chosen later — oxen-server |

---

## How to use this file

1. Pick a **priority band** (P0–P3).
2. Choose rows with `Exists in Boxen` = `No` or `Partial` whose TODO tag matches available capacity (`UI-only` before `new backend`).
3. Implement → add/adjust Playwright coverage → flip the cell to `Yes` or narrower `Partial`.
4. Keep IDs stable; add new rows with the next free suffix rather than renumbering.

Related: [README.md](./README.md) · Playwright suites in `e2e/tests/` (IDs `P-*` … `L-*`) · planned [TESTS.md](./TESTS.md).
