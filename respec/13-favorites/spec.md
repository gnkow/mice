Status: needs-info
Blocked on: Q2 vs Q3 contradiction (favorites feed notifications vs removal of the implicit-watch claim and settings hint); to be resolved in 14.

# 13 — Favorites (PLAT-FAV)

## Problem Statement

Users want quick access to the repositories, branches, jobs, stages and other entities they care about. Whether a favorite also feeds notifications is unresolved (see Conflicts and open risks).

## Solution

Per-Principal favorites stored in PostgreSQL, with stars across lists, sort-by-favorite (server-side for paginated lists; Desktop Sessions are not favoritable), a profile panel and a CLI.

## User Stories

1. As a user, I want to star an entity, so that I find it again.
2. As a user, I want favorites first in lists, so that important items are on top.
3. As a user, I want favorites-first ordering to hold across pages of jobs, so that it is not page-local.
4. As a user, I want to see all favorites in my profile.
5. As a user, I want branch favorites per repository only.
6. As a user, I want a favorite on a deleted entity purged, so that the list stays clean.
7. As a user, I want favorites to survive repository rename and transfer.
8. As a user, I want legacy `workspace` favorites mapped to `stage` only where the reference resolves; unresolved ones are reported as dropped.
9. As a CLI user, I want `mice favorite list --type stage`.
10. As an instance admin, I see only my own favorites, including entities I can read through admin rights; favorites are owner-only.
11. As a user, I accept that an IdP `sub` is never reused or migrated (IdP change is unsupported); no migration tool exists.
12. As a user, I want a favorite not to override a disabled notification category (applies only if favorites feed notifications at all).

## Implementation Decisions

- Keyed by Principal (`iss`+`sub`) and entity reference using stable repository id.
- Add a `favorites=first` parameter to the job list endpoint now (Desktop Sessions dropped); other lists degrade gracefully.
- Branch favorites per repository only, keyed by branch name; purged on branch delete.
- Favorites do not bypass disabled notification categories.
- Favorites are owner-only; admins see only their own list.
- Purge on delete: synchronous for Main-database entities, asynchronous for oxen-resident ones, via a leased consumer with durable cursor, idempotent by stable id, plus sweep.
- No local-star import.

## Testing Decisions

- HTTP tests: toggle, list ordering with pagination, purge on delete, legacy mapping.
- Prior art: existing favorites tests and the sort control in web e2e.

## Out of Scope

Cross-repo branch view, cross-IdP merging.

## Further Notes

Server-side ordering needs a stable pagination cursor.

Open grilling questions: see questions.md in this folder.

## Decisions from grilling

Notification coupling
- Favorites feed notifications as originally planned (Q2) — contradicted by Q3.
- Remove the implicit-watch claim and the settings hint (Q3).
- Persist resolved recipients per event (Q21).
- Audit a favorite toggle only if it affects notification routing; otherwise exempt; amends 00 Q3 (Q1).

Ordering, scale and lists
- Composite keyset cursor plus favorites version stamp (Q4).
- Index on (owner, entity id); per-type cap of 1,000; measure at 10M rows (Q5).
- Paginated profile panel, per-type cursor, batched checks, published ceiling (Q13).
- Keep default order with an indicator/label where favorites-first is not offered (Q15).
- Keep Jobs, drop Desktop Sessions; per-type cap (Q16).
- Inline favorite flags in Jobs list; degrade elsewhere (Q25).
- Group by repository, central module, request cache (Q20).

Identity, visibility, lifecycle
- Branch favorite keyed by name; purged on branch delete; head shown (Q6).
- Owner-only; an admin sees their own list incl. admin-readable entities (Q10).
- 404 for unreadable and nonexistent entities (Q9).
- Hide-and-restore on access loss; counts from visible items only (Q23).
- Lost-access favorites kept and ignored (Q24).
- No IdP migration tool (IdP change unsupported, auth Q29/Q80); a rehired person keeps the Principal if the sub matches (auth S8); revoked favorites purged after a period (Q11).
- Principal-table FK; unique (principal, type, ref) (Q19).
- Service principals removed, so internal principals are rejected (Q12).
- Legacy workspace and stage are distinct types; map if resolves; report dropped (Q14).
- Local star removed without import (Q17).

Storage, purge and API
- Leased consumer, durable cursor, idempotent purge by stable id, Main-database sweep (Q7).
- FKs for Main-database entities; read-time validation for oxen-resident; sweep (Q8).
- Synchronous purge for Main-database entities, asynchronous for oxen-resident, bounded polling (Q26).
- Path-addressed API, stable ids, PUT with state (Q18).
- CLI prints resolved id; explicit id/confirm when non-interactive (Q22).

## Conflicts and open risks

- Q2 vs Q3: favorites feed notifications versus removal of the implicit-watch claim and settings hint. Unresolved here; must be settled in 14 (Notifications still describes per-job subscription as a favorite/watch). Blocks status.
- Q24 RISK: keeping favorites for lost-access entities raises GDPR/data-retention questions; Q11 purge-after-period only covers revoked Principals.
- Q1 amends 00 Q3 (audit exemption for non-routing toggles); needs confirmation in 00 and 03 given GxP strict always on.
- Q11: migration tool REMOVED (auth Q80); IdP change is unsupported.
- Q16/Q25: Desktop Sessions dropped and lists degrade, so the favorite user story set is narrower than the original spec.
- Q9 aligns with 02 Q15 (server-side filtering of favorites); leakage test required per endpoint.
- Q8: oxen-resident entities are only validated at read time, so dangling favorites are possible until the sweep.
