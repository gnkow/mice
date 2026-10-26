# 07: Notification entries and deliveries are rows

**What to build:** A notification transaction no longer rewrites every entry and delivery; only the records it changes are written.

**Blocked by:** 03-keyed-collections

**Status:** done

- [ ] Entries, deliveries and events are collections; the document keeps cursor, users, preferences, subscriptions and tombstones
- [ ] Existing notification tests stay green
- [ ] Existing databases are migrated from the document
- [ ] Write cost no longer grows with history
