Status: needs-triage

# 19: Audit unit tests flake under concurrency

## Problem

With `npx tsx --test --test-concurrency=4 $(find src -name '*.test.ts')` these tests fail, and pass when run alone:

- `auditIntent.test.ts`: intent-first proxied mutations, listing intent and outcome
- readiness: `/readyz pings the ledger without reading the trail`

They share the immudb ledger, so concurrent files see each other's events and ledger state. This hides real regressions in the full suite run.

## Acceptance

- [ ] The full suite passes with `--test-concurrency=4` on three consecutive runs
- [ ] Tests assert only on events they wrote (isolated by sequence or a per-test namespace), or the ledger is isolated per test file
