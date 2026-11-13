/**
 * GxP ticket 25 / #111 — mutable-entity versioning inventory.
 *
 * Every mutable BFF domain entity is listed once with either reconstructable
 * append-only entity version history (not Audit) or an explicit exemption.
 */

export type VersioningStatus = 'versioned' | 'exempt'

export type EntityVersionEntry = {
  id: string
  entity: string
  status: VersioningStatus
  /** Where successive states live (table / oxen / module). */
  store?: string
  /** Historic read seam when versioned. */
  historySeam?: string
  /** Required when status === 'exempt'. */
  rationale?: string
  coverage: string
}

export const ENTITY_VERSION_INVENTORY: EntityVersionEntry[] = [
  // ── Already expected versioned before tickets 21–24 ───────────────────────
  {
    id: 'oxen.repo-data',
    entity: 'Oxen repository data (files, commits, branches)',
    status: 'versioned',
    store: 'oxen',
    historySeam: 'oxen History / versions APIs (proxied)',
    coverage: 'oxen; not conflated with Audit or BFF entity history',
  },
  {
    id: 'principal.names',
    entity: 'Principal display names',
    status: 'versioned',
    store: 'principal_name_history',
    historySeam: 'GET /auth/admin/principals/names',
    coverage: 'auth/src/nameChangeHistory.test.ts; nameHistoryRoutes',
  },
  {
    id: 'rbac.roles',
    entity: 'RBAC principal roles',
    status: 'versioned',
    store: 'principal_role_history',
    historySeam: 'rbac history / admin views',
    coverage: 'auth/src/rbacHistoryAppendOnly.test.ts',
  },
  {
    id: 'rbac.permissions',
    entity: 'RBAC principal permissions',
    status: 'versioned',
    store: 'principal_permission_history',
    historySeam: 'rbac history / admin views',
    coverage: 'auth/src/rbacHistoryAppendOnly.test.ts',
  },
  {
    id: 'rbac.permission-snapshots',
    entity: 'RBAC effective permission snapshots',
    status: 'versioned',
    store: 'permission_snapshots',
    historySeam: 'permission snapshot reads',
    coverage: 'auth/src/rbacStore.test.ts (S12)',
  },
  {
    id: 'meta.revisions',
    entity: 'Metadata records',
    status: 'versioned',
    store: 'meta_records + meta_revisions + meta_history',
    historySeam: 'GET /auth/meta/history',
    coverage: 'metaRoutes; meta_history append-only',
  },
  {
    id: 'access.flags',
    entity: 'Principal access flags (Mice suspension)',
    status: 'versioned',
    store: 'principal_flag_history',
    historySeam: 'GET /auth/admin/mice-suspension (history)',
    coverage: 'miceSuspension.ts suspensionHistory',
  },

  // ── Tickets 21–24 ─────────────────────────────────────────────────────────
  {
    id: 'ns.settings',
    entity: 'Namespace settings',
    status: 'versioned',
    store: 'namespace_settings_versions',
    historySeam: 'GET /auth/namespaces/:ns/settings/history',
    coverage: 'auth/src/namespaceSettingsVersions.test.ts',
  },
  {
    id: 'ns.membership',
    entity: 'Namespace membership set',
    status: 'versioned',
    store: 'namespace_membership_versions',
    historySeam: 'GET /auth/namespaces/:ns/members/history',
    coverage: 'auth/src/namespaceMembershipVersions.test.ts',
  },
  {
    id: 'repo.collaborators',
    entity: 'Repository collaborator set',
    status: 'versioned',
    store: 'repo_collaborator_versions',
    historySeam: 'GET /auth/namespaces/:ns/repos/:repo/collaborators/history',
    coverage: 'auth/src/repoCollaboratorVersions.test.ts',
  },
  {
    id: 'custom.roles',
    entity: 'Custom namespace/repo role definitions',
    status: 'versioned',
    store: 'custom_role_versions',
    historySeam: 'GET /auth/namespaces/:ns/custom-roles/history',
    coverage: 'auth/src/customRoleVersions.test.ts',
  },

  // ── Gaps → follow-ons ─────────────────────────────────────────────────────
  {
    id: 'approvers',
    entity: 'Namespace / repository approvers',
    status: 'exempt',
    rationale:
      'Mutable AuthZ seats without append-only versions yet — follow-on https://github.com/gnkow/mice/issues/124 to add entity history (large gap).',
    coverage: 'namespaceApprovers / repoApprovers live tables only; follow-on #124',
  },

  // ── Exemptions ────────────────────────────────────────────────────────────
  {
    id: 'audit.events',
    entity: 'Audit trail events',
    status: 'exempt',
    rationale: 'Audit is who/when/why/result in immudb — explicitly not entity version history.',
    coverage: 'ADR / GxP story 15; auditLedger',
  },
  {
    id: 'tombstones.ns-repo',
    entity: 'Namespace / repository name tombstones',
    status: 'exempt',
    rationale: 'Reuse-prevention locks after delete/rename, not successive entity states.',
    coverage: 'authzRepository.test.ts entity name tombstones',
  },
  {
    id: 'tombstones.notifications',
    entity: 'Notification tombstones',
    status: 'exempt',
    rationale: 'Derived cache so Novu feed can hide deleted resources.',
    coverage: 'notifications.ts',
  },
  {
    id: 'favorites',
    entity: 'User favorites',
    status: 'exempt',
    rationale: 'Personal UI preference; not a regulated domain entity.',
    coverage: 'favoritesRoutes',
  },
  {
    id: 'announcements',
    entity: 'Instance announcements',
    status: 'exempt',
    rationale: 'Broadcast chrome; prior text is not reconstructed for GxP entity history.',
    coverage: 'announcementsStore',
  },
  {
    id: 'sessions.web-desktop',
    entity: 'Web / desktop sessions',
    status: 'exempt',
    rationale: 'Ephemeral session lifecycle; recording of desktop sessions is globally out of scope.',
    coverage: 'GxP decision; sessionsRoutes / webSessions',
  },
  {
    id: 'jobs',
    entity: 'Jobs',
    status: 'exempt',
    rationale: 'Compute orchestration; dataset effects are versioned in oxen when published.',
    coverage: 'jobsRoutes',
  },
  {
    id: 'access-requests',
    entity: 'Access requests',
    status: 'exempt',
    rationale:
      'Workflow tickets with terminal status; who/why lives in Audit. Not successive reconstructable domain states.',
    coverage: 'accessRequests table; Audit outcomes',
  },
  {
    id: 'training',
    entity: 'Instance training completions',
    status: 'exempt',
    rationale: 'Append-only completion marks per principal; no in-place mutation of a prior completion.',
    coverage: 'instanceTraining',
  },
  {
    id: 'group-binding-status',
    entity: 'Group binding mode status',
    status: 'exempt',
    rationale: 'Singleton operational flag for IdP group binding; changes are audited.',
    coverage: 'groupBindingStatus',
  },
  {
    id: 'seal-keys',
    entity: 'Seal keys',
    status: 'exempt',
    rationale:
      'Rotation creates new rows with validFrom/validUntil; not the GxP entity-version pattern for domain AuthZ. Crypto lifecycle audited separately.',
    coverage: 'sealKeys; sealKeyRoutes',
  },
  {
    id: 'access-review-reports',
    entity: 'Quarterly access review reports',
    status: 'exempt',
    rationale: 'Immutable signed documents once generated; not successive states of a live entity.',
    coverage: 'accessReviewReports',
  },
  {
    id: 'cli-credentials',
    entity: 'CLI credential families / tokens',
    status: 'exempt',
    rationale: 'Credential material lifecycle with revocation markers; not domain entity state reconstruction.',
    coverage: 'cliCredentialFamilies / tokens',
  },
  {
    id: 'lineage-ops',
    entity: 'Derived lineage ops',
    status: 'exempt',
    rationale: 'Derived from oxen path history; rebuild is re-derivation, source of truth is oxen versions.',
    coverage: 'lineageOps; lineage rebuild',
  },
  {
    id: 'idp-baseline-drift',
    entity: 'IdP baseline / drift reports',
    status: 'exempt',
    rationale: 'Compliance snapshots and reports; append-only check rows, not AuthZ domain entities.',
    coverage: 'idpBaseline / idpDriftReports',
  },
  {
    id: 'device-authorizations',
    entity: 'CLI device authorizations',
    status: 'exempt',
    rationale: 'Short-lived pending login flow state.',
    coverage: 'deviceAuthorizations',
  },
]

export function entityVersionInventory(): EntityVersionEntry[] {
  return ENTITY_VERSION_INVENTORY
}

export function versionedEntities(): EntityVersionEntry[] {
  return ENTITY_VERSION_INVENTORY.filter((e) => e.status === 'versioned')
}

export function exemptEntities(): EntityVersionEntry[] {
  return ENTITY_VERSION_INVENTORY.filter((e) => e.status === 'exempt')
}
