# 08: Owner audit scope proven across namespaces

**What to build:** Prove that a namespace Owner's audit query, including facets and exports, never returns events from other namespaces or events with no namespace.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Test: Owner of namespace A sees none of namespace B's events, via list, facets and any export path
- [x] Events without a namespace are not visible to Owners
- [x] Any leak found is fixed server-side before paging
