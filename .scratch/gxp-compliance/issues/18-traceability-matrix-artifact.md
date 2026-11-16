# 18: Traceability matrix artifact

**What to build:** Requirement ids appear in test names. A generated traceability matrix ships as a release artifact stored with the audit trail.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] GxP requirement ids are present in the relevant test names
- [x] A traceability matrix is generated from those tagged tests
- [x] The matrix is stored with the release audit trail

## Comments

**Deep-api Close (2026-11-16):** Audit found stub-only `generateTraceabilityMatrix`. Closed at seams `extractGxpRequirementIds` / `buildTraceabilityMatrixFromTestNames` / `recordTraceabilityMatrixRelease`; script `auth/scripts/generate-traceability-matrix.mjs` → `auth/traceability-matrix.json`; boot records digest via `verifyAndRecordReleaseManifest`. Unit: `traceabilityMatrix.test.ts`. Tagged GXP-R-008/013/014/026/061/063 in existing HTTP/unit tests.
