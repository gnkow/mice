# STAGES — server-side staging areas (Oxen workspaces), later and independent

Status: **not scheduled.** This file only parks the feature that Mice previously called "workspaces" so the word is free for the overlay working trees in [Workspaces.md](./Workspaces.md). Behaviour today is unchanged; only the label changes (Workspaces.md §10).

## What it is
An Oxen workspace is a server-side staging area: a base commit (branch head) plus staged changes in a RocksDB, with file bytes in the repo's version store. It supports staging uploads/removals over HTTP, listing staged changes, and committing to a branch (`merge`/`commit`). It has no mountable filesystem and no locking, and a commit conflicts only when the branch changed a path the workspace also staged.

## Good uses (why keep it)
- Browser/CLI "edit and commit" without a local clone (upload → review staged → commit).
- Review area for batch uploads before they become a commit.
- Used transiently as the **atomic commit builder** inside Mice workspaces (Workspaces.md §7.1) — that internal use is not a user-facing Staging area.

## Scope when scheduled (outline)
- Naming in UI/CLI/docs follows the **Stages** decision below (`/stages`, `mice stage …`, favorites type `stage`; existing ids `ns/repo!<id>` stay valid).
- Keep current screens (list, detail, staged changes, file upload, commit) and e2e coverage; fix gaps then: base-advance/behind indicators, multi-file delete, conflict messaging, authz path map entries for `…/workspaces/**` under a custom-role resource `staging`.
- Out of scope: mounting, locking, jobs, sessions.

## Naming
**Decided: Stages** (a single Oxen workspace is a *stage*; UI nav and route `/stages`, CLI `mice stage`, favorites type `stage`). This is what the web, CLI and favorites code already use (`web/src/App.tsx` routes `stages` / `stages/:workspaceId`; `auth/src/favoritesStore.ts` `FAVORITE_TYPES` includes `stage` and maps legacy `workspace` rows to it; `mice favorite list --type …|stage|…`). It supersedes the earlier **Staging** decision (`/staging`, `mice staging`, favorites kind `staging`, authz resource `staging`), which was never shipped; [Workspaces.md §10](./Workspaces.md) still says Staging in places and should read Stages. "Staging" survives only as the generic term for the server-side staging area. Earlier candidates (Vaults, Drafts, Shelves, Stashes, Changesets, Inboxes) were rejected.

## Existing routes remain reachable
The Oxen workspace routes stay available and unchanged for now: the BFF/oxen-server `…/workspaces/**` API (authz actions `workspace.read` / `workspace.write` / `workspace.create` …) and clients that still use it. The rename is label-only; Mice workspaces (overlay working trees) are a separate feature and never reuse these routes.

## Deprecation / migration (proposed, not scheduled)
- [ ] Decide whether the `workspace.*` authz actions and the `…/workspaces/**` path map get a `stage` resource name, with aliases and a migration of custom roles
- [ ] Retire the `mice workspace …` alias and any `/workspaces` UI redirects once Mice workspaces ship (Workspaces.md W5), with a one-release deprecation notice
- [ ] Keep legacy favorites rows (`workspace` type, `ns/repo!<id>`) readable through the migration

Open questions:
1. Does the authz resource keep the `workspace` action names indefinitely, or move to `stage` with a compatibility window?
2. Should the old `/workspaces` UI path redirect to `/stages` once Mice workspaces claim it?
