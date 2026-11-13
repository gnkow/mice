# 09: Group ID Binding - Admin Validation

**What to build:** Admin settings page validates that the configured IdP provides group IDs in claims. If group IDs are unavailable, show a warning to the administrator explaining the limitation (IdP group rename will break access silently). Provide a fallback mode that uses normalized names with a persistent warning flag visible to namespace owners.

**Blocked by:** 08 (Group ID Binding - Schema and Extraction)

**Status:** done

- [x] Admin settings page: "Group binding validation" section
- [x] Check button: validates IdP provides group IDs by inspecting sample claims or IdP metadata
- [x] If IDs available: display "Group binding mode: ID-based (recommended)"
- [x] If IDs unavailable: display warning "Group IDs not available. Binding uses names. IdP group rename will break access."
- [x] Namespace owners can see binding mode (ID-based vs name-based) for their group bindings
- [x] Warning persists in UI when name-based fallback is active
- [x] Tests verify validation detects Azure AD group IDs
- [x] Tests verify validation detects Keycloak group IDs
- [x] Tests verify warning shown when IDs unavailable
- [x] Tests verify namespace owners see binding mode indicator

## Notes

- Pure: `auth/src/groupBindingMode.ts` (`assessGroupBindingMode`)
- Persist: `group_binding_status` + `GET/POST /auth/instance/group-binding[/check]`
- Namespace: members include `bindingMode`; `groupBindingWarning` when any grant is name-based
- UI: Settings → Group binding; Namespace members show mode + warning

## Comments

**Deep-api Deepen (2026-11-13):** Holds at `groupBindingMode` / `checkGroupBindingMode`. Top: `groupBindingAssessment` owns `warning`; `assessGroupBindingMode` and status store reuse it. Unit: `groupBindingMode.test.ts`. Integration: store seam + `/auth/instance/group-binding` in `groupBindingMode.api.test.ts`.

**Deep-ui Deepen (2026-11-13):** Holds at Settings → Group binding. Mode badge + status region, optional sample-id textarea, owner-warning hint on name-based. E2E thickened: `e2e/tests/group-binding.spec.ts` TC-GB-01/02/03.
