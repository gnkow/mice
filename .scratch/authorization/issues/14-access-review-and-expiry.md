# 14: Access Review and Mandatory Expiry

**What to build:** Outside collaborator grants (users not in the namespace) and delegated instance permissions have mandatory expiry dates. Access review workflow allows admins to generate quarterly reports listing all users and their grants. Report can be signed by a reviewer (digital signature). Expired grants are automatically revoked. This supports regulatory compliance requirements for periodic access review (ISO 27001, Annex 11).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Add `expires_at` column to `repoCollaborators` table (required for outside collaborators)
- [ ] Add `expires_at` column to instance permission grants (required for delegated permissions)
- [ ] Admin UI: when granting outside collaborator, expiry date is required field
- [ ] Admin UI: when granting instance permissions (non-bootstrap), expiry date is required field
- [ ] Background job: check for expired grants daily, revoke expired access, audit the revocation
- [ ] Access review report generation: list all users, roles, grants, last login for a quarter
- [ ] Access review report signing: reviewer can digitally sign the report (signature record)
- [ ] Admin UI: view/download signed access review reports
- [ ] Tests verify outside collaborators require expiry date
- [ ] Tests verify delegated instance permissions require expiry date
- [ ] Tests verify expired grants are revoked automatically
- [ ] Tests verify access review report generation
- [ ] Tests verify report signing workflow
