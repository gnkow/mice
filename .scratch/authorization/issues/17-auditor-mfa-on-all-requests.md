Status: needs-triage

# 17: Auditor MFA on every request

**Spec:** `.specs/01-authentication.md` (Q78, T3)

**Follow-up to:** `13-auditor-access.md`

## What to build

Ticket 13 requires MFA evidence for the Auditor's cross-ACL read bypass (`authz.ts`, repo routes) and for instance actions (`decideInstanceAction`, including audit reads). Other paths are not gated. An Auditor session without MFA can still use namespace and repo routes that it reaches through ordinary membership or ACL grants, and any route that does not go through those two checks.

Gate the Auditor role at one place that every authorization decision passes through, so the rule cannot be bypassed by a new route.

## Acceptance

- [ ] List every decision path an Auditor session can reach (instance, namespace, repo, lineage, signing)
- [ ] An Auditor session without MFA is refused on all of them with a single reason
- [ ] The rule lives in one function, not repeated per check
- [ ] A test per decision path fails without the gate
