# 06: Instance Admin Data Access Restriction

**What to build:** Instance admins can manage platform settings and users, but have zero data and audit access (spec 02: no audit read). They cannot be granted namespace membership roles, cannot grant themselves namespace roles (self-granting blocked), and cannot access repository data. During bootstrap, if zero non-admin users exist, namespace creation is blocked with a message prompting the admin to grant `create_namespace` to a manager first.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Add check in `setNamespaceMember`: if target is instance admin, return error "Instance admins cannot be granted namespace membership (separation of duties)"
- [x] Self-granting check: if actor is instance admin AND target is actor, return error
- [x] Remove instance admin data access bypass from authorization checks
- [x] Instance admins can access: admin settings, user management, instance configuration only (no audit logs, per spec 02)
- [x] Bootstrap check: count non-admin users; if zero, block namespace creation with helpful error
- [x] Update admin UI to hide data-related actions for instance admins (NamespacesListPage Delete gated on Owner only; admin-only data controls elsewhere not found)
- [x] Tests verify instance admin cannot be granted namespace Owner/Member
- [x] Tests verify instance admin cannot access repository data
- [x] Tests verify instance admin can manage users and is denied audit/lineage reads
- [x] Tests verify bootstrap blocks namespace creation with zero non-admin users

## Comments

**Deep-api Deepen (holds).** Audit: SoD membership check and bootstrap gate held; unit present; dead `addInstanceAdmin` import in `instanceAdminSeparation.test.ts`; SoD string inline.

**Deepen:** `refuseInstanceAdminMembership` + `INSTANCE_ADMIN_MEMBERSHIP_REFUSAL` in `authzMembershipStore.ts`; `refuseNamespaceCreateBootstrap` + `NAMESPACE_CREATE_BOOTSTRAP_REFUSAL` in `authz.ts`. Removed dead import. Strengthened unit (self-grant + SoD gate) and thin route integration (manager cannot add instance admin as member).
