# 06: Instance Admin Data Access Restriction

**What to build:** Instance admins can manage platform settings, users, and audit logs, but have zero data access. They cannot be granted namespace membership roles, cannot grant themselves namespace roles (self-granting blocked), and cannot access repository data. During bootstrap, if zero non-admin users exist, namespace creation is blocked with a message prompting the admin to grant `create_namespace` to a manager first.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Add check in `setNamespaceMember`: if target is instance admin, return error "Instance admins cannot be granted namespace membership (separation of duties)"
- [ ] Self-granting check: if actor is instance admin AND target is actor, return error
- [ ] Remove instance admin data access bypass from authorization checks
- [ ] Instance admins can access: admin settings, audit logs, user management, instance configuration only
- [ ] Bootstrap check: count non-admin users; if zero, block namespace creation with helpful error
- [ ] Update admin UI to hide data-related actions for instance admins
- [ ] Tests verify instance admin cannot be granted namespace Owner/Member
- [ ] Tests verify instance admin cannot access repository data
- [ ] Tests verify instance admin can manage users and view audit
- [ ] Tests verify bootstrap blocks namespace creation with zero non-admin users
