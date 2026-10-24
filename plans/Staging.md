# STAGING — server-side staging areas (Oxen workspaces), later and independent

Status: **not scheduled.** This file only parks the feature that Mice previously called "workspaces" so the word is free for the overlay working trees in [Workspaces.md](./Workspaces.md). Behaviour today is unchanged; only the label changes (Workspaces.md §10).

## What it is
An Oxen workspace is a server-side staging area: a base commit (branch head) plus staged changes in a RocksDB, with file bytes in the repo's version store. It supports staging uploads/removals over HTTP, listing staged changes, and committing to a branch (`merge`/`commit`). It has no mountable filesystem and no locking, and a commit conflicts only when the branch changed a path the workspace also staged.

## Good uses (why keep it)
- Browser/CLI "edit and commit" without a local clone (upload → review staged → commit).
- Review area for batch uploads before they become a commit.
- Used transiently as the **atomic commit builder** inside Mice workspaces (Workspaces.md §7.1) — that internal use is not a user-facing Staging area.

## Scope when scheduled (outline)
- Rename in UI/CLI/docs: nav **Staging**, route `/staging`, `mice staging …` (alias `mice workspace …` removed once Mice workspaces ship), favorites kind `staging` (existing ids `ns/repo!<id>` stay valid).
- Keep current screens (list, detail, staged changes, file upload, commit) and e2e coverage; fix gaps then: base-advance/behind indicators, multi-file delete, conflict messaging, authz path map entries for `…/workspaces/**` under a custom-role resource `staging`.
- Out of scope: mounting, locking, jobs, sessions.

## Naming
Decided: **Staging** (UI nav, route `/staging`, CLI `mice staging`, favorites kind `staging`, authz resource `staging`). It matches `git add`/Oxen staged-changes terminology. Earlier candidates (Vaults, Drafts, Shelves, Stashes, Changesets, Inboxes) were rejected.

> **Update:** Oxen workspaces are now called **Stages** (UI `/stages`, CLI `mice stage`, favorites type `stage`). Sessions and jobs can no longer mount a stage; only commit-pinned read-only snapshots are mounted. Mountable Mice workspaces (this doc) remain the future mount target.
