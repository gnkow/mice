---
status: proposed
---

# Metadata search starts on PostgreSQL full-text; a search engine only on measured need

## Context

Metadata search needs a derived index, authorization filtering of every hit, accurate counts and facets (00 Q20, 12 Q26, 16 Q25). A dedicated engine adds a store, an outbox consumer, snapshot/replay and a drift detector. We have no measurements showing PostgreSQL cannot meet the need.

## Decision

- Search is built on PostgreSQL full-text search (`tsvector` + GIN) in the main database, behind one search module interface, fed from the same data and the outbox as other derived facts.
- The BFF filters every hit through authorization; counts and facets are computed after filtering.
- A search engine is introduced only if a measured requirement fails on a representative corpus.
- Re-qualification procedure: define the corpus size, query mix and latency/relevance targets up front; run the benchmark on every release candidate and when the corpus grows past a recorded threshold; on failure, prototype the engine behind the same interface, run both in parallel, compare results and authorization-leak tests, then cut over with a new ADR.

## Consequences

- No new store at first; the index is transactional with the data, so access changes apply synchronously.
- The search module interface must stay engine-neutral.
- Benchmarks and a hidden-tag leakage test become release gates.
- Relevance and faceting are weaker than a dedicated engine.

## Alternatives rejected

- Start with an engine: speculative cost and operational surface.
- Postgres FTS with no exit plan: risks an unplanned rewrite if limits are hit.
