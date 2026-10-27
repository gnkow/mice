# 09: Group ID Binding - Admin Validation

**What to build:** Admin settings page validates that the configured IdP provides group IDs in claims. If group IDs are unavailable, show a warning to the administrator explaining the limitation (IdP group rename will break access silently). Provide a fallback mode that uses normalized names with a persistent warning flag visible to namespace owners.

**Blocked by:** 08 (Group ID Binding - Schema and Extraction)

**Status:** ready-for-agent

- [ ] Admin settings page: "Group binding validation" section
- [ ] Check button: validates IdP provides group IDs by inspecting sample claims or IdP metadata
- [ ] If IDs available: display "Group binding mode: ID-based (recommended)"
- [ ] If IDs unavailable: display warning "Group IDs not available. Binding uses names. IdP group rename will break access."
- [ ] Namespace owners can see binding mode (ID-based vs name-based) for their group bindings
- [ ] Warning persists in UI when name-based fallback is active
- [ ] Tests verify validation detects Azure AD group IDs
- [ ] Tests verify validation detects Keycloak group IDs
- [ ] Tests verify warning shown when IDs unavailable
- [ ] Tests verify namespace owners see binding mode indicator
