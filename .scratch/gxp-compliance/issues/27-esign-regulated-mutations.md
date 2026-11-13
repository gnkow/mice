# 27: Electronic signature on regulated mutations

**What to build:** Every mutation class that requires a reason (ticket 03) also requires a Part 11 electronic signature before it runs. Creates stay exempt. The web reason dialog becomes the signing ceremony.

**Blocked by:** 01, 03, 04

**Status:** done

## Notes

- Same action set as `mutationNeedsReason` / reason policy; creates exempt.
- Ceremony: step-up MFA → `POST /auth/sign/prepare-mutation` (canonical JSON + hash) → `POST /auth/sign/execute` (meaning `Approved`) → mutation with `X-Mice-Signature-Id`.
- Canonical document: `{ v:1, method, path, action, reason, category, body }` (stable key order; non-JSON proxy bodies use `{ sha256 }`).
- Gate verifies signer, meaning, freshness (5 min), content hash, and single-use (`esign.consumed` append-only).
- Change-control id: client header, else id stored on the signature, else server mint.
- Audit events carry `signature_id` alongside reason / change-control id.

## Acceptance

- [x] Regulated mutations refuse without a valid signature (`signature_required` / `signature_invalid`)
- [x] Creates accepted without a signature
- [x] Matching ceremony + retry succeeds; reused or mismatched signatures refuse
- [x] Web ceremony collects reason/category, shows hash/meaning/name, executes, retries with signature id
- [x] Regulated config exposes signature policy (`allocation: ceremony`, meaning Approved)
- [x] HTTP/unit tests cover refuse, accept, reuse, and hash mismatch

## Comments

- **Audit:** holds (prepare route + WIP module) but gate was not wired and module was missing from git.
- **Deepen (auto-pick Top):** `evaluateMutationSignatureBinding` pure seam; `resolveMutationSignature` owns store lookup/consume.
- **Seams:** `prepareMutationDocument` / `evaluateMutationSignatureBinding` / `resolveMutationSignature` (module); `routeGuard` + `proxy` (HTTP); admin/ceremony via `/auth/sign/prepare-mutation`.
