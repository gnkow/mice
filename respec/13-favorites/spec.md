Status: ready-for-agent

# 13 — Favorites (PLAT-FAV)

## Problem Statement

Users want quick access to the repositories, branches, jobs, sessions, stages and other entities they care about, and a hint for notifications.

## Solution

Per-Principal favorites stored in PostgreSQL, with stars across lists, sort-by-favorite (server-side for paginated lists), a profile panel and a CLI.

## User Stories

1. As a user, I want to star an entity, so that I find it again.
2. As a user, I want favorites first in lists, so that important items are on top.
3. As a user, I want favorites-first ordering to hold across pages of jobs and sessions, so that it is not page-local.
4. As a user, I want to see all favorites in my profile.
5. As a user, I want branch favorites per repository only.
6. As a user, I want a favorite on a deleted entity purged, so that the list stays clean.
7. As a user, I want favorites to survive repository rename and transfer.
8. As a user, I want legacy `workspace` favorites read as `stage`.
9. As a CLI user, I want `mice favorite list --type stage`.
10. As an instance admin, I want to see favorites for entities I can read through admin rights.
11. As a user with a changed `sub` or other IdP, I accept that I have different favorites (distinct Principal).
12. As a user, I want a favorite not to override a disabled notification category.

## Implementation Decisions

- Keyed by Principal (`iss`+`sub`) and entity reference using stable repository id.
- Add a `favorites=first` parameter to job and session list endpoints now.
- Branch favorites per repository only.
- Favorites do not bypass disabled notification categories.
- Cluster-visible admins see favorites on entities they can read.
- Purge on delete via the audit observer plus sweep, multi-instance safe.

## Testing Decisions

- HTTP tests: toggle, list ordering with pagination, purge on delete, legacy mapping.
- Prior art: existing favorites tests and the sort control in web e2e.

## Out of Scope

Cross-repo branch view, cross-IdP merging.

## Further Notes

Server-side ordering needs a stable pagination cursor.
