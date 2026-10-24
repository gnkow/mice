# ADMINISTRATION — PLAT-ADMIN implementation plan

Living design and phased plan for epic `PLAT-ADMIN` — **Administration console & in-app docs**: the admin/user-facing UX surface (Settings, announcements, access-request inbox, directory pickers, Profile, Docs, Home) that exists in code but had no dedicated plan.

Related: [EPICS.md](./EPICS.md) · [01-authentication.md](./01-authentication.md) · [02-authorization.md](./02-authorization.md) · [03-audit.md](./03-audit.md) · [04-gxp-compliance.md](./04-gxp-compliance.md) · [07-cli.md](./07-cli.md) · [13-favorites.md](./13-favorites.md) · [14-notifications.md](./14-notifications.md) · [16-operations.md](./16-operations.md)

## 1. Purpose & scope

**In scope (UX / console surface)**

- Settings page sections: Connection, Access requests, Authorization policy, Instance administrators, Delegated permissions, Announcements
- Instance announcements and the banner
- Access-request inbox UX and the `/pending` page
- Directory search and pickers used by admin forms; IdP-group bootstrap as it affects first-login UX
- Training acknowledgement (admin/self API; no web UI today)
- Profile page, Docs page, Home dashboard

**Out of scope (cross-linked, not duplicated)**

- Roles, groups, base permissions, policy evaluation, custom-role semantics, `AUTHZ_ENFORCE` semantics — [02-authorization.md](./02-authorization.md)
- Session/PAT lifecycle, revocation semantics — [01-authentication.md](./01-authentication.md)
- Audit store, retention, query UI — [03-audit.md](./03-audit.md); GxP training/onboarding evidence — [04-gxp-compliance.md](./04-gxp-compliance.md)
- Inbox, toasts, email/push delivery — [14-notifications.md](./14-notifications.md); favorites panel internals — [13-favorites.md](./13-favorites.md)
- `mice` CLI command design — [07-cli.md](./07-cli.md); deployment/backup/health — [16-operations.md](./16-operations.md)

## 2. Current state

Status is verified against the code listed in each row. Authorization decisions are owned by [02-authorization.md](./02-authorization.md); the table only records which gate the UX relies on.

| Piece | Behavior | Evidence |
| --- | --- | --- |
| Settings shell | Left `SectionNav`; "Connection" for everyone (API base URL override, "Test connection" via `fetchServerVersion`); "Access requests" shown to all signed-in users; "Administration" group only when `isInstanceAdmin` | [`web/src/pages/SettingsPage.tsx`](../web/src/pages/SettingsPage.tsx) |
| Authorization policy | Single checkbox toggling store `enforce` (`PATCH /auth/instance`); UI notes env `AUTHZ_ENFORCE` overrides; audited `instance.settings.update` | `SettingsPage.tsx` (`InstanceAdminSection`), [`auth/src/index.ts`](../auth/src/index.ts) |
| Instance administrators | List/add/remove admins; "Revoke sessions" by `iss`+`sub` (admin-only endpoints `/auth/instance/admins`, `/auth/instance/revoke-sessions`) | `SettingsPage.tsx`, `auth/src/index.ts` |
| Delegated permissions | Set per-user instance permissions (`PUT /auth/instance/permissions`); audited `instance.permissions.update` | `SettingsPage.tsx`, `auth/src/auditLabels.ts` |
| Access-request inbox | Reviewers see list with Approve (namespace + role, or instance permission) / Deny. Instance admins and `create_namespace` holders see full history; other reviewers see pending only (`review_access_requests` capability) | `SettingsPage.tsx` (`AccessRequestsSection`), [`auth/src/accessRequests.ts`](../auth/src/accessRequests.ts), `GET/POST /auth/access-requests` |
| `/pending` page | Zero-grant user submits optional message → `POST /auth/access-requests`; links to Notifications, Profile, Sign out | [`web/src/pages/PendingAccessPage.tsx`](../web/src/pages/PendingAccessPage.tsx) |
| Announcements (server) | JSON store `announcements.json`; fields title (≤120), message (≤2000), severity `info/warning/critical`, `active`, optional `expiresAt`, `createdBy`; non-admins get live ones only, `?all=1` admin-only; create/update/delete audited | [`auth/src/announcementsStore.ts`](../auth/src/announcementsStore.ts), `auth/src/index.ts` (`/auth/announcements*`), [`auth/src/announcements.test.ts`](../auth/src/announcements.test.ts) |
| Announcements (web) | Admin section: publish form (title, severity, message, optional `datetime-local` expiry), Hide/Show, Delete with `window.confirm`; `AnnouncementBanner` mounted in `Layout` for signed-in users, polls every 5 min, per-browser dismissal keyed by `id:updatedAt` in `localStorage` | [`web/src/components/AnnouncementsSection.tsx`](../web/src/components/AnnouncementsSection.tsx), [`AnnouncementBanner.tsx`](../web/src/components/AnnouncementBanner.tsx), [`web/src/lib/announcements.ts`](../web/src/lib/announcements.ts) |
| Announcements (CLI) | `mice announcement list/create/enable/disable/delete` documented in CLI usage text | [`cli/mice.mjs`](../cli/mice.mjs) |
| Directory search | `GET /auth/directory/search` (users/groups, `limit`); allowed for instance admins, access-request reviewers, `manage_members` holders; Keycloak Admin API when configured, else store-only fallback (`DIRECTORY_PROVIDER=none`) | [`auth/src/directory.ts`](../auth/src/directory.ts), `directory.test.ts`, [`web/src/components/DirectoryPicker.tsx`](../web/src/components/DirectoryPicker.tsx) |
| Group bootstrap | `AUTHZ_GROUP_BOOTSTRAP` JSON maps IdP group/identity → instance permissions and namespace membership (optionally creating the namespace) at login; no UI | [`auth/src/groupBootstrap.ts`](../auth/src/groupBootstrap.ts), `auth/src/env.ts` |
| Custom roles UI | `CustomRolesSection` rendered on namespace/repo settings pages, not on `/settings`; semantics in 02 | [`web/src/components/CustomRolesSection.tsx`](../web/src/components/CustomRolesSection.tsx) |
| Training | `POST /auth/training` (self-complete, or admin sets for another user); `AUTHZ_REQUIRE_TRAINING` denies non-admins without it at the proxy; audited `training.update`; `GET /auth/me/authz` exposes `trainingCompleted`/`requireTraining`; CLI usage lists `mice training set`. **No web UI** — `web/src/lib/auth.ts` only has the types | `auth/src/index.ts`, `auth/src/authz.ts`, `authzStore.ts` |
| Profile | Sections: Account (name/email, read-only, SSO-managed), Appearance (theme light/dark/system, diff palette, saved in `localStorage`), Favorites, Notifications (embedded), CLI tokens | [`web/src/pages/ProfilePage.tsx`](../web/src/pages/ProfilePage.tsx), `web/src/lib/appearance.ts` |
| Docs | Static page of three external links (Oxen docs, oxen-server, API reference); no Mice-specific or versioned content in `web/` | [`web/src/pages/DocsPage.tsx`](../web/src/pages/DocsPage.tsx) |
| Home | Tile dashboard (namespaces, repositories, workspaces, jobs, sessions) with counts and "create" shortcuts; jobs count capped by `limit: 100` | [`web/src/pages/HomePage.tsx`](../web/src/pages/HomePage.tsx) |

### Authorization and audit coverage

| Action | Gate | Audit action |
| --- | --- | --- |
| Read live announcements | any signed-in user | none (read) |
| Read all / create / update / delete announcement | `isInstanceAdmin` (403 otherwise) | `announcement.create/update/delete` |
| Submit access request | any signed-in user | `access-request.submit` |
| List / resolve access requests | `canReviewAccessRequests` (resolution checks in `resolveAccessRequest`) | `access-request.approve/deny` (failures audited with status 400) |
| Toggle enforce, manage admins, delegated permissions, revoke sessions | `isInstanceAdmin` | `instance.*` (see [`auditLabels.ts`](../auth/src/auditLabels.ts)) |
| Training update | self, or admin path in `setTrainingCompleted` (403 audited) | `training.update` |
| Directory search | `canSearchDirectory` | none (read) |
| Profile appearance / dismissals | client-only | none |

The notifications routes also have an admin `POST …/announcements` that fans out an inbox notification; the banner announcement store does **not** call it, so publishing a banner does not notify ([`auth/src/notifications.ts`](../auth/src/notifications.ts); see [14-notifications.md](./14-notifications.md)).

### Test coverage

| Area | Existing tests |
| --- | --- |
| Announcement store (validation, live filtering, update/delete) | `auth/src/announcements.test.ts` |
| Announcement UI flow (publish → banner → dismiss → hide → delete) | [`e2e/tests/announcements.spec.ts`](../e2e/tests/announcements.spec.ts) |
| Access requests, instance permissions/enforce, directory, training, custom roles | [`e2e/tests/authz.spec.ts`](../e2e/tests/authz.spec.ts) (`TC-AUTHO-access-request/-review/-deny/-approve-perm`, `-instance`, `-directory`, `-training`); `auth/src/authz.test.ts`, `directory.test.ts` |
| Notifications, favorites on Profile | `e2e/tests/notifications.spec.ts`, `favorites.spec.ts` |
| Docs page, Home dashboard, Profile appearance, `/pending` page | none found dedicated (not verified in other specs such as `nav.spec.ts` / `smoke.spec.ts`) |

## 3. Goals & non-goals

**Goals**

1. Give instance admins one coherent, discoverable console without duplicating the authorization model.
2. Keep every admin mutation authorized server-side and audited (current state meets this for the rows above).
3. Make admin lists usable at scale and accessible.
4. Make in-app docs describe *Mice*, not only upstream Oxen.

**Non-goals**

- Re-specifying roles/policy (see [02-authorization.md](./02-authorization.md)).
- A multi-tenant SaaS admin plane.
- Replacing the IdP's user/group administration (Keycloak/Entra stay the source of identity).

## 4. Phased delivery

### Phase 0 — Shipped surface (documented here)

- [x] Settings page with Connection, Access requests and (admin-only) Authorization policy, Instance administrators, Delegated permissions, Announcements sections
- [x] Instance announcements: store, admin API, audit, Settings UI, banner with per-browser dismissal, CLI commands in usage text
- [x] Access-request submit from `/pending`, reviewer inbox with approve/deny, scoped visibility (pending-only vs full history)
- [x] Directory search with Keycloak provider + store fallback, used by pickers
- [x] IdP group bootstrap (`AUTHZ_GROUP_BOOTSTRAP`)
- [x] Training acknowledgement API + gate + audit (no web UI)
- [x] Profile page (Account, Appearance, Favorites, Notifications, CLI tokens)
- [x] Docs page (external links) and Home tile dashboard

### Phase 1 — Admin overview & lists (proposed, not approved)

- [ ] Admin overview section/page: pending access requests, live announcements, enforce state, admin count, latest failed-admin audit events (links to [03-audit.md](./03-audit.md) UI)
- [ ] Pagination, search and filters for access requests, admins and permission grants (Settings renders full lists today; no `Pagination` use found in the Settings/Announcements components)
- [ ] Bulk actions: approve/deny several requests, bulk-set permissions (single audit event per item, shared batch id)
- [ ] Access-request UX: show requester message/age, optional deny reason, notify requester on resolution ([14-notifications.md](./14-notifications.md))
- [ ] Replace `window.confirm` in announcement delete with the shared `ConfirmProvider`/`confirmDelete` pattern already in `web/src/components`

### Phase 2 — Announcements v2 (proposed, not approved)

- [ ] Edit in place (API supports `PATCH` of title/message/severity/expiry; UI offers only Hide/Show/Delete)
- [ ] Scheduling: `startsAt` in addition to `expiresAt`
- [ ] Audience targeting (all / instance admins / namespace members / group)
- [ ] Optional "also notify" toggle that emits the inbox announcement ([14-notifications.md](./14-notifications.md)); decide whether dismissal should be server-side for GxP "read and understood" needs ([04-gxp-compliance.md](./04-gxp-compliance.md))
- [ ] Markdown/link support in message (reuse `web/src/lib/markdown.ts` with sanitization) — currently plain text

### Phase 3 — Training in the UI (proposed, not approved)

- [ ] Web UI for self-acknowledgement when `requireTraining` is true and `trainingCompleted` is false (today a gated user sees 403s from the proxy and must use the CLI/API)
- [ ] Admin view of who has/has not completed training, with revoke
- [ ] Training content/version and evidence link — coordinate with [04-gxp-compliance.md](./04-gxp-compliance.md)

### Phase 4 — In-app docs (proposed, not approved)

- [ ] Choose a content source: Markdown shipped in `web/` (versioned with the app), served from the BFF, or a configurable docs URL
- [ ] Mice-specific guides: access request flow, PATs and CLI ([07-cli.md](./07-cli.md)), workspaces/jobs/sessions, GxP notes
- [ ] Search and "docs for this version" link; keep the upstream Oxen links
- [ ] Contextual help links from admin sections

### Phase 5 — Cross-cutting quality (proposed, not approved)

- [ ] Accessibility pass: keyboard/focus on `SectionNav` and modals, banner `role` semantics (critical = `alert`, others `status` already), contrast of severity colors in dark mode and colorblind palette, automated axe check in e2e
- [ ] i18n readiness: strings are inline English in components and `<html lang="en">`; decide on a message-catalog approach before adding locales
- [ ] Empty/error states: Settings sections swallow load errors (e.g. access-request and namespace fetches `catch` to `null`/`[]`); use `StateBlock` with retry and distinguish "forbidden" from "failed"
- [ ] Home: surface pending-access count for reviewers and live announcements; avoid `limit: 100` job count truncation
- [ ] Profile: sessions/PAT security overview shared with [01-authentication.md](./01-authentication.md); account deletion/offboarding is owned there

## 5. Test plan

| Case | Expectation | Status |
| --- | --- | --- |
| TC-ADM-01 | Non-admin `GET /auth/announcements?all=1` and all announcement writes → `403`; unauthenticated → `401` | Store tested; route-level gate covered only indirectly — proposed API test |
| TC-ADM-02 | Admin publish → banner visible → dismiss → edit shows again → hide → delete | Covered except re-show after edit (`announcements.spec.ts`) |
| TC-ADM-03 | Expired or inactive announcement never appears for non-admins; admin list shows "Hidden"/expired | Store test exists; add UI case (proposed) |
| TC-ADM-04 | Each announcement/instance/access-request/training mutation writes the expected audit action and label | Proposed route-level test against [03-audit.md](./03-audit.md) |
| TC-ADM-05 | Reviewer with only `review_access_requests` sees pending only; admin sees full history | Proposed (logic in `GET /auth/access-requests`) |
| TC-ADM-06 | Pagination/search on admin lists with >N rows | Proposed (Phase 1) |
| TC-ADM-07 | Training-gated user can self-acknowledge from the UI and then reach `/` | Proposed (Phase 3) |
| TC-ADM-08 | Docs page renders local guides and links; no dead links | Proposed (Phase 4) |
| TC-ADM-09 | Axe scan of Settings, Profile, `/pending` with no serious violations | Proposed (Phase 5) |
| TC-ADM-10 | Directory search denied for pending users and users without admin/review/`manage_members` | Unit-covered in `directory.test.ts` |

## 6. Open risks

| Risk | Mitigation |
| --- | --- |
| Announcement `message` is rendered as text today; adding Markdown could open XSS | Sanitize, reuse the existing Markdown component rules, add a test |
| Banner dismissal is per-browser, so it cannot prove a user saw a critical notice | Server-side acknowledgement if GxP requires it ([04-gxp-compliance.md](./04-gxp-compliance.md)) |
| JSON-file stores (`announcements.json`, `access-requests.json`) are read-modify-write | Acceptable for single instance; revisit with [16-operations.md](./16-operations.md) |
| Access-request `read` listing grows unbounded | Pagination (Phase 1) |
| Admin console gaps push admins to env/CLI, bypassing audit-friendly UI | Keep the CLI and UI on the same audited endpoints |
| Training gate without UI locks out users silently | Phase 3; interim message from the proxy deny reason |

### Open questions

1. Should announcements have an audience, or remain instance-wide?
2. Should group-bootstrap rules be editable in the UI, or stay env-only (config-as-code)?
3. Is the Docs page expected to ship Mice-authored content, and who owns it?
4. Should the admin overview live under `/settings` or a new `/admin` route?
5. Which locales (if any) are required, and is a GxP "read receipt" needed for announcements?

## 7. How to use this file

1. Implement one phase at a time; tick bullets in PRs.
2. Proposed items stay `[ ]` until approved and shipped; only tick `[x]` after verifying in code.
3. Authorization-model changes go to [02-authorization.md](./02-authorization.md), not here.
4. When an `EPICS.md` entry for `PLAT-ADMIN` is added, link it to this file.
