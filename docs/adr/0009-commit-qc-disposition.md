---
status: accepted
---

# Commit QC is Unset / Valid / Invalid via disposition maps

Validated branches (tip-write gate) and commit QC are **orthogonal**. A validated tip’s ancestry must have no **Unset** commits; each commit is **Valid** or **Invalid**. QC is not auto-set to Valid on signed merge.

Disposition changes only through a signed **disposition map** (one e-signature binds `{ commitId → Valid | Invalid }`). Authors may set **Invalid** on their own commits but never **Valid**. Ad-hoc disposition needs repo write+ (Approver role not required). Completing a merge into a validated branch still requires Approver: they must disposition every Unset commit in the incoming range (and the merge commit) and may override existing Valid/Invalid on that range. Mark-validated requires an explicit map for every still-Unset tip-ancestry commit.

**Empty-tip create carve-out:** Oxen requires a tip for named branches, so Mice materializes a file-less bootstrap commit and attributes it to the creator. When create marks a branch validated, that tip is set **Valid** under the creator’s create e-signature (scaffold QC, not self-approval of work product). Bare creates (`branches: []`) skip tips and this disposition.

**Invalid** is soft: audit and UI warnings only; Pins and Jobs may use any commit. Open merge requests do not write QC (no “Marked” state). Greenfield: persist `unset` | `valid` | `invalid` only; revoke/revert are not the QC-change mechanism.

## Considered options

- Keep Passed/Failed driven by merge + revoke (prior model): simpler ceremony, but cannot land Invalid on a validated branch or disposition outside Approver/merge.
- MR-level approval only (GitLab-style): no per-commit Valid/Invalid; rejects the product requirement to mix Invalid into validated history.
- Hard-block Pins on Invalid: stronger runtime gate, rejected so compute stays usable on condemned history.

## Consequences

- Merge-complete and mark-validated UIs must collect a disposition map; defaulting all Valid is UI sugar, not silent server behavior.
- Self-Valid deadlock: complete/mark refuses if the signer would Valid their own Unset commits.
- Spec 04 / 05 language moves from Passed/Failed/Marked to Unset/Valid/Invalid; covering-signature remains the link from commit to latest disposition signature.
