Status: ready-for-agent

# 05 — Namespaces, repositories and version browsing (PLAT-REPO)

## Problem Statement

Scientists need to create, browse, merge, rename and transfer repositories with confidence that platform data (access, favorites, metadata, lineage, audit) follows them.

## Solution

Repository lifecycle and browsing through the BFF with dedicated audited actions. Every repository has a stable Mice id; rename and transfer keep it. Merge with the `maintain` role is the review gate.

## User Stories

1. As a scientist, I want to create a repository in a namespace, so that I can start versioning data.
2. As a scientist, I want to browse branches, commits and files, so that I can see history.
3. As a scientist, I want large listings and previews paged and capped, so that the app stays responsive.
4. As a maintainer, I want to merge a branch, so that work reaches the main line.
5. As a repository admin, I want to rename a repository, so that names stay meaningful.
6. As a repository admin, I want the rename to preserve access, favorites, metadata and lineage, so that nothing is lost.
7. As a repository admin, I want to transfer a repository to another namespace, so that ownership can change.
8. As a destination namespace owner, I want transfer to require my namespace's write permission, so that repositories are not dumped on me.
9. As a repository admin, I want to delete a repository and have dependent platform data cleaned up, so that nothing is orphaned.
10. As an auditor, I want dedicated audit actions for rename and transfer, so that they are not logged as "other".
11. As a user, I want tags on a repository, so that I can organise them (provided by metadata, not a separate feature).
12. As a user, I want a rename failure to leave the original intact, so that errors are recoverable.

## Implementation Decisions

- Stable repository id in PostgreSQL; the oxen name is an attribute.
- Rename is implemented at the BFF as copy then delete on oxen, with the Mice id retained and the whole operation audited as Intent/Outcome; a crash between steps is reconciled.
- Open detail: whether copy preserves commit ids must be verified against oxen-server; if not, lineage and audit commit references need an alias table.
- Merge page plus `maintain` is the gate; no PR product in this spec.
- A separate repository tag store is dropped; PLAT-META tags cover it.
- Transfer requires repo `admin` and destination namespace `write` (confirm).
- Preview and listing ceilings are configurable with defaults chosen during implementation.

## Testing Decisions

- HTTP tests for rename, transfer, delete and cascades, including a simulated failure in the middle of rename.
- Test that authz path map and role enforcement agree.
- Prior art: existing repository API tests.

## Out of Scope

PR-style review, rename in stock oxen-server.

## Further Notes

Rename as copy+delete is heavy for large repositories; consider size warnings.
