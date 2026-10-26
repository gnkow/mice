---
status: withdrawn
---

# Lease renewals are audited as one Intent/Outcome per lease, not per renewal

Withdrawn: the owner chose strict per-renewal audit (auth round 6 S1); no exception is needed.

## Context

A lease is a time-limited lock a Workspace holds: while it is valid, one holder may write, and when it expires another may take over and the old holder is stopped (fenced). The holder renews it every few seconds. The cross-cutting rule (00 Q3) is that every mutation records an Intent in immudb first and, in strict mode, is refused when the Intent cannot be stored, with no class exempt. Applied to renewals, a two-minute immudb restart would expire every lease and fencing would kill running jobs that have hours of work left (08 Q18).

## Decision

- Each lease has one Intent when granted and one Outcome when it ends (released, expired, force-released, or terminated on denied re-authorization).
- The Outcome summarises renewals: count, first and last renewal time, holder, fencing token.
- Renewals themselves write no Intent and are not refused when immudb is down.
- Lease TTL is longer than the longest audit outage we tolerate, so renewals alone cannot expire a lease during an outage.
- Grant, release, force-release, re-authorization failure and any write made under the lease keep full per-mutation Intent.
- This is the only documented exception to "no mutation class is exempt".

## Consequences

- An inspector sees the lease history in one record, not thousands of heartbeats.
- Renewal is still authorization-checked (re-authorized at each renewal); a denial ends the lease with an Outcome.
- The spec must state the exception next to 00 Q3, and validation must cover it.
- Longer TTL means a crashed holder blocks the Workspace for longer.

## Alternatives rejected

- Renewals as strict mutations: an immudb outage kills all running jobs.
- Exempt renewals and omit them entirely: loses evidence of who held the lock and how long.
- Exempt only in an outage: two code paths and harder to validate.
