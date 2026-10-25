---
status: accepted
---

# The audit trail is stored in immudb and its proofs replace our hash chain

The BFF's own hash chain (`prev_hash`, `hash`), signed checkpoints and chain verification are removed. The audit module appends events to immudb and relies on immudb's verified reads and Merkle proofs for tamper evidence. The Intent event rule is unchanged: if an Intent event cannot be stored the mutation is refused with 503. The Outcome event still carries the `intent_id` of its Intent event.

## Considered options

- Keep our chain and use immudb only as the store: gives an auditor evidence that does not depend on the database vendor, at the cost of two integrity mechanisms.
- Separate PostgreSQL with an INSERT-only role: one engine, but tamper evidence is a configuration property.

## Consequences

- Tamper evidence depends entirely on immudb's proofs; GxP validation documents that reference the chain or signed checkpoints must be revisited.
- `auditChain`, `auditCheckpoint` and `auditSigning` and their verification endpoint are replaced by the audit module's `verify`.
- Events written by tests cannot be removed from the dev audit database.

## Implementation note

The maintained Node client (`immudb-node` 1.1.1) fails its own proof verification against server 1.9.5. `auditLedger.ts` therefore verifies the transaction chain itself (accumulated hash, value hash, entry root, head vs. `currentState`) over `txScan`.
