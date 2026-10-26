# 09: The audit module records Intent and Outcome events in immudb and verifies with its proofs

**What to build:** A separate audit module with append, read range and verify, implemented on immudb. Every mutation still stores an Intent event first and refuses with 503 if it cannot; Outcome events carry the `intent_id`. The hash chain, signed checkpoints, signing key and their verification endpoint are removed; verify uses immudb verified reads. Export and review of a range works.

**Blocked by:** 01, 03

**Status:** done

- [ ] Intent event stored before the mutation; failure yields 503 and no mutation
- [ ] Outcome event links to its Intent event
- [ ] Verify reports tampering detectable by immudb proofs and success otherwise
- [ ] Read range returns events by sequence
- [ ] Chain, checkpoint and signing code and the `audit_signing_key` secret are removed
- [ ] Tests filter by unique ids and never assume an empty audit trail
- [ ] Targeted e2e passes (audit-gxp, adjusted to the new verify)

## Outcome

- `auth/src/auditLedger.ts` is the immudb adapter; `audit.ts` is async and ledger-backed. Hash chain, signing, checkpoints and the signing key are removed.
- `immudb-node` 1.1.1 cannot verify proofs from server 1.9.5 (`verifiedSet`/`verifiedGet` fail), so the ledger recomputes the accumulated hash chain, value hashes and single-entry roots itself and checks the head against `currentState`.
- Tests share one `audit_test` database with a private key prefix per file (immudb is append-only).
- The e2e audit-gxp spec now stops immudb to prove fail-closed (503) and no longer tampers with the log.
