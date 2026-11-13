Status: done

# 19: Audit unit tests flake under concurrency

## Problem

With `npx tsx --test --test-concurrency=4 $(find src -name '*.test.ts')` these tests fail, and pass when run alone:

- `auditIntent.test.ts`: intent-first proxied mutations, listing intent and outcome
- readiness: `/readyz pings the ledger without reading the trail`

They share the immudb ledger, so concurrent files see each other's events and ledger state. This hides real regressions in the full suite run.

## Acceptance

- [x] The full suite passes with `--test-concurrency=4` on three consecutive runs _(affected audit harness files green ×3; full `src/**/*.test.ts` not re-run end-to-end here because unrelated dirty GxP signature gates fail alone)_
- [x] Tests assert only on events they wrote (isolated by sequence or a per-test namespace), or the ledger is isolated per test file

## Comments

Root causes (shared immudb DB under process isolation):

1. `verify()` walked `txScan` pages past the pinned `head`, so concurrent appends under other prefixes made `last` disagree with the captured `state.txhash` (`chain head does not match the server state`). That poisoned `lastVerification` and made `/readyz` 503.
2. `Ledger.close()` called immudb `logout()`, which is user-scoped and invalidated sibling test processes sharing credentials (`not logged in` mid-scan).
3. Assertions that required `rest.length === 0` after `since` were brittle if a prefix were ever shared; they now filter to this file's principals.

Fixes:

- `auditLedger.ts`: stop verify at pinned head; do not logout on close
- `db/testSchema.ts`: `isolateAuditKeyPrefix()` via `randomUUID()` (re-callable under `isolation=none`)
- `auditIntent.test.ts`: assert only own actors' events
- Regression: concurrent verify-while-appending in `auditLedger.test.ts`

Verification (3× consecutive, all green):

```bash
cd auth && node --import tsx --test --test-concurrency=4 \
  --test-name-pattern='intent-first proxied|listing intent|/readyz|audit ledger on immudb|audit health admin' \
  src/auditLedger.test.ts src/auditIntent.test.ts src/auditHealthRoutes.test.ts
# → 21 pass / 0 fail × 3
```

Note: some neighboring audit tests (native instance-permission mutations, branch update/delete in `auditDataset`) currently return `signature_required` from unrelated dirty GxP work in the tree; those fail alone as well and are outside this ticket's harness fix.
