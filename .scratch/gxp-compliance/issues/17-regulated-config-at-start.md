# 17: Regulated config at start

**What to build:** The effective regulated configuration is written to audit at each start or change and is visible in the admin overview.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Effective regulated configuration is written to audit at each instance start
- [x] Changes to regulated configuration are written to audit
- [x] Admin overview shows the currently effective regulated configuration

## Notes

- Boot records `system.regulated_config.start` (and `.change` when the digest differs from the previous boot).
- Admin `GET /auth/admin/regulated-config` surfaces the last recorded snapshot (or live effective config).

## Comments

- **Audit:** holds (WIP module + routes + tests). Unit+integration present.
- **Deepen (auto-pick Top):** `evaluateRegulatedConfigAtStart` as the pure digest/previous-boot seam; `recordRegulatedConfigAtStart` audits from that result.
- **Seams:** `effectiveRegulatedConfig` / `evaluateRegulatedConfigAtStart` (module); boot record; admin regulated-config route.
