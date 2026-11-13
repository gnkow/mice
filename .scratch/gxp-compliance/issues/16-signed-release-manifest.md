# 16: Signed release manifest

**What to build:** Each release carries a signed manifest (versions and digests of IdP configuration, search index, custom verifiers) verified at start. A mismatch is audited and shown in the admin overview.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Release ships a signed manifest of IdP configuration, search index and custom verifiers
- [x] Manifest is verified at start
- [x] Mismatch is audited and visible in the admin overview

## Notes

- `auth/release-manifest.json` is signed via `scripts/sign-release-manifest.mjs` (Ed25519).
- Boot calls `verifyAndRecordReleaseManifest`; admin `GET/POST /auth/admin/release-manifest/*` surfaces status.

## Comments

- **Audit:** holds (module + routes + tests existed as WIP). Unit+integration present.
- **Deepen (auto-pick Top):** export `buildReleaseManifestBody` + `verifyReleaseManifestSignature`; signing script imports the same seam (no duplicated live digests).
- **Seams:** `buildReleaseManifestBody` / `signReleaseManifest` / `verifyReleaseManifestSignature` (module); boot verify+audit; admin release-manifest routes.
