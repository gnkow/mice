# 02: Stable Namespace IDs Infrastructure

**What to build:** Add UUID id column to namespaces table so that namespaces can be renamed without breaking authorization grants, repository foreign keys, or audit references. When a user creates a namespace and grants membership, the system uses the namespace ID throughout. Namespace rename does not break existing memberships or repository associations.

**Blocked by:** 01 (Stable Repository IDs Infrastructure)

**Status:** done

- [x] Add `id` (UUID) column to `namespaces` table, make it the primary key
- [x] Keep `name` column with unique constraint (names still unique, but not the PK)
- [x] Backfill UUIDs for existing namespaces
- [x] Update `repositories` table FK: `namespace_id` references `namespaces.id`
- [x] Update namespace creation to mint UUID
- [x] Authorization membership checks resolve namespace ID from name on each request
- [x] API responses include `namespace_id` field
- [x] Tests verify namespace creation returns stable ID
- [x] Tests verify namespace rename preserves ID
- [x] Tests verify authorization works by ID after rename
