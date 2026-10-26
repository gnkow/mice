---
status: proposed
amends: 0004
---

# Novu only delivers notifications; the PostgreSQL inbox projection is authoritative

## Context

ADR 0004 says Novu "owns notifications". The interview (14 Q8, 00 Q26) found that wording makes two systems claim the same fact: who has which unread message. Novu holds content for a limited time (90-day TTL, 14 Q1) and is a delivery provider, not a record.

## Decision

- The recipient inbox projection in PostgreSQL is the source of truth for what each Principal was notified about, read state and visibility. The UI reads it, filtered by authorization.
- Novu is used only to deliver (email, push, in-app feed transport). It carries ids and safe summaries; restricted content and all push use generic external text (14 Q9, Q20).
- The projection is built from audit events through the outbox. Delivery facts are audited; Novu's transaction id gives idempotency (owner chose this over a ledger; the dedupe-window gap after a long replay is a known risk).
- Wording in ADR 0004 ("owns notifications") is replaced when this is accepted.

## Consequences

- Losing or rebuilding Novu loses no inbox state; it is replayed from Postgres.
- Notifications are not records; the 90-day TTL applies to Novu and provider logs.
- The BFF must keep the projection and the delivery attempt consistent through the outbox.

## Alternatives rejected

- Novu as the inbox of record: unfilterable by our authorization and expiring.
- Dedicated delivery ledger for idempotency: more state; owner overrode it.
- Replace Novu: not needed for delivery.
