# 12: Service principal design review

**What to build:** A grilling session that settles the details the spec leaves open before any code: how authorization membership and instance permissions apply to `urn:mice:service|<uuid>` principals, what the audit actor looks like, how favorites and notifications treat them, what a PAT-only identity means for the scope rules, and how ownership and suspension interact with admin revocation. The output is an updated spec section and, if warranted, an ADR.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Decisions recorded in the spec (and an ADR if the trust model changes)
- [x] Tickets 13–15 confirmed or adjusted
