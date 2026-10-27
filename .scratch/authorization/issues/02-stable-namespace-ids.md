# 02: Stable Namespace IDs Infrastructure

**What to build:** Add UUID id column to namespaces table so that namespaces can be renamed without breaking authorization grants, repository foreign keys, or audit references. When a user creates a namespace and grants membership, the system uses the namespace ID throughout. Namespace rename does not break existing memberships or repository associations.

**Blocked by:** 01 (Stable Repository IDs Infrastructure)

**Status:** ready-for-agent

- [ ] Add `id` (UUID) column to `namespaces` table, make it the primary key
- [ ] Keep `name` column with unique constraint (names still unique, but not the PK)
- [ ] Backfill UUIDs for existing namespaces
- [ ] Update `repositories` table FK: `namespace_id` references `namespaces.id`
- [ ] Update namespace creation to mint UUID
- [ ] Authorization membership checks resolve namespace ID from name on each request
- [ ] API responses include `namespace_id` field
- [ ] Tests verify namespace creation returns stable ID
- [ ] Tests verify namespace rename preserves ID
- [ ] Tests verify authorization works by ID after rename
