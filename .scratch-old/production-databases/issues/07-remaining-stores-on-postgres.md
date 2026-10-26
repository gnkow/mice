# 07: Favorites, announcements and the remaining relational stores live in PostgreSQL

**What to build:** Every remaining database-shaped store (favorites, announcements, directory sync state and any other JSON document or collection not covered by tickets 04-06, 08-10) moves to typed tables, asynchronous. A grep for remaining uses of the document, collection and log store interfaces shows only disk state and the audit and notification modules slated for their own tickets.

**Blocked by:** 03

**Status:** done

- [x] Each remaining store is PostgreSQL-only and asynchronous
- [x] Free-form payloads use JSON columns only where genuinely free-form
- [x] Tests use unique ids and own-row cleanup
- [x] An inventory in the ticket's comments lists what moved

## Inventory (comments)

Moved to PostgreSQL tables: `favorites` (user, type, id), `announcements`, `directory_sync_state` (singleton) and `directory_sync_revoked`. Favorites purge runs in SQL. Still on the old interfaces by design: metadata (08), audit (09), notifications (10).
