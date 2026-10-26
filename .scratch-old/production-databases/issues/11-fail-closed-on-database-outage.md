# 11: A database outage fails closed

**What to build:** When PostgreSQL, immudb or Novu is unreachable, `/readyz` is red and requests that need it return 503, never a partial success. Recovery is automatic when the database returns.

**Blocked by:** 04, 05, 06, 07, 08, 09, 10

**Status:** done

- [ ] Stopping each database container turns `/readyz` red and affected requests to 503
- [ ] No mutation proceeds without its Intent event
- [ ] Restarting the container restores service without restarting the BFF
- [ ] Covered by tests that use an unreachable connection configuration, not by stopping shared containers

## Outcome

`createApp` maps store-outage errors (`db/outage.ts`: network, PostgreSQL connection classes, gRPC UNAVAILABLE, Novu unreachable) to 503; `openSession` no longer turns a failed revocation lookup into a 401. Unit test `outage.test.ts` (all stores unreachable) and e2e `outage.spec.ts` (stops postgres and novu-api, expects 503 and red `/readyz`, then automatic recovery); immudb is covered by `audit-gxp.spec.ts` GXP-02.
