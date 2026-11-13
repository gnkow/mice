/**
 * GxP ticket 26 / #112 — reason-policy operation inventory.
 *
 * Every mutating BFF route and every proxied dataset action class is listed once.
 * `required` means category + free text (and the regulated signature ceremony on
 * native BFF routes that use `guarded({ reason: true })`). `exempt` needs a rationale.
 */

export type ReasonRequirement = 'required' | 'exempt'

export type ReasonPolicyEntry = {
  id: string
  surface: 'dataset' | 'bff'
  /** Dataset action class, or `METHOD path` for BFF-native routes. */
  key: string
  reason: ReasonRequirement
  /** Required when reason === 'exempt'. */
  rationale?: string
  /** Pointer to unit/HTTP coverage that proves the classification. */
  coverage: string
}

/** Proxied oxen/dataset mutation classes (see `auditReason.ts`). */
const DATASET: ReasonPolicyEntry[] = [
  {
    id: 'ds.namespace.create',
    surface: 'dataset',
    key: 'namespace.create',
    reason: 'exempt',
    rationale: 'Create of a new resource; creates never require a reason.',
    coverage: 'auth/src/auditReasonPolicy.test.ts; auth/src/auditReason.test.ts',
  },
  {
    id: 'ds.repo.create',
    surface: 'dataset',
    key: 'repo.create',
    reason: 'exempt',
    rationale: 'Create of a new resource.',
    coverage: 'auth/src/auditReasonPolicy.test.ts',
  },
  {
    id: 'ds.branch.create',
    surface: 'dataset',
    key: 'branch.create',
    reason: 'exempt',
    rationale: 'Create of a new resource.',
    coverage: 'auth/src/auditReason.test.ts',
  },
  {
    id: 'ds.file.write',
    surface: 'dataset',
    key: 'file.write',
    reason: 'exempt',
    rationale:
      'Treated as new data at the policy class level until overwrite detection lands (ticket 26 notes).',
    coverage: 'auth/src/auditReason.test.ts',
  },
  {
    id: 'ds.file.delete',
    surface: 'dataset',
    key: 'file.delete',
    reason: 'required',
    coverage: 'auth/src/auditReasonPolicy.test.ts; auth/src/auditReason.test.ts (proxy)',
  },
  {
    id: 'ds.branch.update',
    surface: 'dataset',
    key: 'branch.update',
    reason: 'required',
    coverage: 'auth/src/auditReasonPolicy.test.ts',
  },
  {
    id: 'ds.branch.delete',
    surface: 'dataset',
    key: 'branch.delete',
    reason: 'required',
    coverage: 'auth/src/auditReason.test.ts',
  },
  {
    id: 'ds.repo.delete',
    surface: 'dataset',
    key: 'repo.delete',
    reason: 'required',
    coverage: 'auth/src/auditReasonPolicy.test.ts',
  },
  {
    id: 'ds.repo.metadata',
    surface: 'dataset',
    key: 'repo.metadata',
    reason: 'required',
    coverage: 'auth/src/auditReasonPolicy.test.ts',
  },
  {
    id: 'ds.namespace.update',
    surface: 'dataset',
    key: 'namespace.update',
    reason: 'required',
    coverage: 'auth/src/auditReasonPolicy.test.ts',
  },
  {
    id: 'ds.merge',
    surface: 'dataset',
    key: 'merge',
    reason: 'required',
    coverage: 'auth/src/auditReasonPolicy.test.ts',
  },
  {
    id: 'ds.commit.publish',
    surface: 'dataset',
    key: 'commit.publish',
    reason: 'required',
    coverage: 'auth/src/auditReasonPolicy.test.ts',
  },
  {
    id: 'ds.workspace.commit',
    surface: 'dataset',
    key: 'workspace.commit',
    reason: 'required',
    coverage: 'auth/src/auditReasonPolicy.test.ts',
  },
  {
    id: 'ds.workspace.merge',
    surface: 'dataset',
    key: 'workspace.merge',
    reason: 'required',
    coverage: 'auth/src/auditReasonPolicy.test.ts',
  },
]

/** Synthetic classes used by native privileged routes / policy lists. */
const SYNTHETIC: ReasonPolicyEntry[] = [
  {
    id: 'syn.privileged_settings',
    surface: 'dataset',
    key: 'privileged_settings',
    reason: 'required',
    coverage: 'auth/src/auditReasonPolicy.test.ts; regulated-config requiredActions',
  },
  {
    id: 'syn.revocation',
    surface: 'dataset',
    key: 'revocation',
    reason: 'required',
    coverage: 'auth/src/auditReasonPolicy.test.ts',
  },
  {
    id: 'syn.destructive',
    surface: 'dataset',
    key: 'destructive',
    reason: 'required',
    coverage: 'auth/src/auditReasonPolicy.test.ts',
  },
]

/** BFF-native mutating routes. */
const BFF: ReasonPolicyEntry[] = [
  {
    id: 'bff.ns.create',
    surface: 'bff',
    key: 'POST /auth/namespaces',
    reason: 'exempt',
    rationale: 'Create of a new namespace (create-exempt).',
    coverage: 'auth/src/namespaceRoutes.test.ts',
  },
  {
    id: 'bff.ns.patch',
    surface: 'bff',
    key: 'PATCH /auth/namespaces/:ns',
    reason: 'required',
    coverage: 'auth/src/namespaceSettingsVersions.test.ts; namespaceRoutes.test.ts',
  },
  {
    id: 'bff.ns.delete',
    surface: 'bff',
    key: 'DELETE /auth/namespaces/:ns',
    reason: 'required',
    coverage: 'guarded reason:true on namespaceRoutes',
  },
  {
    id: 'bff.members.put',
    surface: 'bff',
    key: 'PUT /auth/namespaces/:ns/members',
    reason: 'required',
    coverage: 'auth/src/namespaceMembershipVersions.test.ts',
  },
  {
    id: 'bff.members.delete',
    surface: 'bff',
    key: 'DELETE /auth/namespaces/:ns/members',
    reason: 'required',
    coverage: 'auth/src/namespaceMembershipVersions.test.ts',
  },
  {
    id: 'bff.collab.put',
    surface: 'bff',
    key: 'PUT /auth/namespaces/:ns/repos/:repo/collaborators',
    reason: 'required',
    coverage: 'auth/src/repoCollaboratorVersions.test.ts',
  },
  {
    id: 'bff.collab.delete',
    surface: 'bff',
    key: 'DELETE /auth/namespaces/:ns/repos/:repo/collaborators',
    reason: 'required',
    coverage: 'auth/src/repoCollaboratorVersions.test.ts',
  },
  {
    id: 'bff.approvers.put',
    surface: 'bff',
    key: 'PUT /auth/namespaces/:ns/approvers|/auth/namespaces/:ns/repos/:repo/approvers',
    reason: 'required',
    coverage: 'guarded reason:true on namespaceRoutes',
  },
  {
    id: 'bff.approvers.delete',
    surface: 'bff',
    key: 'DELETE /auth/namespaces/:ns/approvers|/auth/namespaces/:ns/repos/:repo/approvers',
    reason: 'required',
    coverage: 'guarded reason:true on namespaceRoutes',
  },
  {
    id: 'bff.custom-role.ns.create',
    surface: 'bff',
    key: 'POST /auth/namespaces/:ns/custom-roles/namespace',
    reason: 'required',
    coverage:
      'auth/src/customRoleVersions.test.ts — AuthZ definition change treated as privileged_settings even on create',
  },
  {
    id: 'bff.custom-role.ns.patch',
    surface: 'bff',
    key: 'PATCH /auth/namespaces/:ns/custom-roles/namespace/:roleId',
    reason: 'required',
    coverage: 'auth/src/customRoleVersions.test.ts',
  },
  {
    id: 'bff.custom-role.ns.delete',
    surface: 'bff',
    key: 'DELETE /auth/namespaces/:ns/custom-roles/namespace/:roleId',
    reason: 'required',
    coverage: 'auth/src/customRoleVersions.test.ts',
  },
  {
    id: 'bff.custom-role.repo.create',
    surface: 'bff',
    key: 'POST /auth/namespaces/:ns/custom-roles/repo',
    reason: 'required',
    coverage: 'auth/src/customRoleVersions.test.ts',
  },
  {
    id: 'bff.custom-role.repo.patch',
    surface: 'bff',
    key: 'PATCH /auth/namespaces/:ns/custom-roles/repo/:roleId',
    reason: 'required',
    coverage: 'auth/src/customRoleVersions.test.ts',
  },
  {
    id: 'bff.custom-role.repo.delete',
    surface: 'bff',
    key: 'DELETE /auth/namespaces/:ns/custom-roles/repo/:roleId',
    reason: 'required',
    coverage: 'auth/src/customRoleVersions.test.ts',
  },
  {
    id: 'bff.instance.permissions',
    surface: 'bff',
    key: 'PUT /auth/instance/permissions',
    reason: 'required',
    coverage: 'auth/src/auditReason.test.ts',
  },
  {
    id: 'bff.instance.group-binding',
    surface: 'bff',
    key: 'POST /auth/instance/group-binding',
    reason: 'required',
    coverage: 'guarded reason:true on instanceRoutes',
  },
  {
    id: 'bff.access-request.decide',
    surface: 'bff',
    key: 'POST /auth/access-requests/:id',
    reason: 'required',
    coverage: 'auth/src/auditReason.test.ts',
  },
  {
    id: 'bff.access-request.create',
    surface: 'bff',
    key: 'POST /auth/access-requests',
    reason: 'exempt',
    rationale: 'Self-service create of a new access request record.',
    coverage: 'meRoutes (no reason flag)',
  },
  {
    id: 'bff.grants.role',
    surface: 'bff',
    key: 'POST /auth/grants/role',
    reason: 'required',
    coverage: 'rbacGrantRoutes reason:true',
  },
  {
    id: 'bff.grants.permissions',
    surface: 'bff',
    key: 'POST /auth/grants/permissions',
    reason: 'required',
    coverage: 'rbacGrantRoutes reason:true',
  },
  {
    id: 'bff.audit.acknowledge',
    surface: 'bff',
    key: 'POST /auth/audit/acknowledge',
    reason: 'required',
    coverage: 'auditRoutes reason:true',
  },
  {
    id: 'bff.meta.write',
    surface: 'bff',
    key: 'PUT|PATCH /auth/meta',
    reason: 'required',
    coverage: 'auth/src/reasonPolicyInventory.test.ts',
  },
  {
    id: 'bff.meta.batch',
    surface: 'bff',
    key: 'POST /auth/meta/batch',
    reason: 'exempt',
    rationale: 'Bulk read of explicit metadata for list views; does not mutate.',
    coverage: 'metaRoutes batchReadPolicy',
  },
  {
    id: 'bff.meta.delete',
    surface: 'bff',
    key: 'DELETE /auth/meta',
    reason: 'required',
    coverage: 'auth/src/reasonPolicyInventory.test.ts',
  },
  {
    id: 'bff.lineage.rebuild',
    surface: 'bff',
    key: 'POST /auth/lineage/rebuild',
    reason: 'required',
    coverage: 'auth/src/reasonPolicyInventory.test.ts',
  },
  {
    id: 'bff.reenable',
    surface: 'bff',
    key: 'POST /auth/admin/re-enable',
    reason: 'required',
    coverage: 'reenableRoutes reason:true',
  },
  {
    id: 'bff.mice-suspension.set',
    surface: 'bff',
    key: 'POST /auth/admin/mice-suspension',
    reason: 'required',
    coverage: 'miceSuspensionRoutes reason:true',
  },
  {
    id: 'bff.mice-suspension.lift',
    surface: 'bff',
    key: 'POST /auth/admin/mice-suspension/lift',
    reason: 'required',
    coverage: 'miceSuspensionRoutes reason:true',
  },
  {
    id: 'bff.training.mark',
    surface: 'bff',
    key: 'POST /auth/training',
    reason: 'exempt',
    rationale: 'Self-attestation creates a new training-completion record for the caller.',
    coverage: 'meRoutes (mutates without reason)',
  },
  {
    id: 'bff.me.tokens.delete',
    surface: 'bff',
    key: 'DELETE /auth/me/tokens/:id',
    reason: 'exempt',
    rationale:
      'Caller-owned credential housekeeping; ticket 03 HTTP coverage asserts no reason gate (auditReason.test.ts).',
    coverage: 'auth/src/auditReason.test.ts',
  },
  {
    id: 'bff.cli.device.approve',
    surface: 'bff',
    key: 'POST /auth/cli/device/approve',
    reason: 'exempt',
    rationale:
      'Interactive session confirmation of a pending CLI device login; the browser session is the authentication, not a regulated data mutation.',
    coverage: 'deviceApprovalConfirmation.test.ts',
  },
  {
    id: 'bff.cli.device.deny',
    surface: 'bff',
    key: 'POST /auth/cli/device/deny',
    reason: 'exempt',
    rationale: 'Companion to device approve; same interactive confirmation model.',
    coverage: 'cliDeviceRoutes',
  },
  {
    id: 'bff.web-session.delete',
    surface: 'bff',
    key: 'DELETE /auth/sessions/web/:id',
    reason: 'exempt',
    rationale: 'Caller ends one of their own web sessions; not a regulated domain-entity mutation.',
    coverage: 'webSessionRoutes',
  },
  {
    id: 'bff.favorites',
    surface: 'bff',
    key: 'PUT|DELETE /auth/favorites',
    reason: 'exempt',
    rationale: 'Personal UI preference; not a regulated domain entity.',
    coverage: 'favoritesRoutes',
  },
  {
    id: 'bff.sessions.desktop',
    surface: 'bff',
    key: 'POST|PUT|DELETE /auth/sessions...',
    reason: 'exempt',
    rationale: 'Ephemeral desktop/compute session lifecycle; not regulated data.',
    coverage: 'sessionsRoutes',
  },
  {
    id: 'bff.jobs',
    surface: 'bff',
    key: 'POST /auth/jobs...',
    reason: 'exempt',
    rationale: 'Compute job orchestration; dataset effects go through proxied mutations that carry their own reason policy.',
    coverage: 'jobsRoutes',
  },
  {
    id: 'bff.reason.declare',
    surface: 'bff',
    key: 'POST /auth/reason',
    reason: 'exempt',
    rationale: 'The declaration endpoint itself; it stores a reason for subsequent mutations.',
    coverage: 'auth/src/auditReason.test.ts',
  },
  {
    id: 'bff.sign.ceremony',
    surface: 'bff',
    key: 'POST /auth/sign/prepare|/auth/sign/prepare-mutation|/auth/sign/execute',
    reason: 'exempt',
    rationale: 'Ceremony endpoints that produce the signature consumed by reason-gated mutations.',
    coverage: 'signingRoutes',
  },
  {
    id: 'bff.admin.revoke',
    surface: 'bff',
    key: 'POST /auth/admin/revoke|/auth/admin/suspend|...confirm|/auth/me/suspend',
    reason: 'exempt',
    rationale:
      'Body carries free-text reason today but not the GxP category+signature ceremony — follow-on #121.',
    coverage: 'adminRevocationRoutes; follow-on #121',
  },
  {
    id: 'bff.seal-keys.rotate',
    surface: 'bff',
    key: 'POST /auth/admin/seal-keys/rotate|/rotate/emergency',
    reason: 'exempt',
    rationale:
      'Privileged crypto control; emergency takes body.reason but neither path uses guarded reason:true — follow-on #122.',
    coverage: 'sealKeyRoutes.test.ts; follow-on #122',
  },
  {
    id: 'bff.announcements',
    surface: 'bff',
    key: 'POST|PATCH|DELETE /auth/announcements...',
    reason: 'exempt',
    rationale: 'Instance broadcast chrome; not a regulated domain entity — follow-on #123 if product wants ceremony.',
    coverage: 'announcementRoutes; follow-on #123',
  },
  {
    id: 'bff.access-review',
    surface: 'bff',
    key: 'POST /auth/admin/access-review/generate|/sign',
    reason: 'exempt',
    rationale:
      'Generate is report creation; sign has its own e-sign path — not the generic reason header gate.',
    coverage: 'accessReviewRoutes',
  },
  {
    id: 'bff.idp-baseline.check',
    surface: 'bff',
    key: 'POST /auth/admin/idp-baseline/check',
    reason: 'exempt',
    rationale: 'Read/compare of IdP baseline; does not mutate regulated domain entities.',
    coverage: 'idpBaselineRoutes',
  },
  {
    id: 'bff.idp-drift',
    surface: 'bff',
    key: 'POST /auth/admin/idp-drift/check|/baseline',
    reason: 'exempt',
    rationale: 'Compliance check / baseline snapshot admin tooling; follow-on if baseline writes need ceremony.',
    coverage: 'idpDriftRoutes',
  },
]

/** Full inventory (dataset + synthetic + BFF). */
export const REASON_POLICY_INVENTORY: ReasonPolicyEntry[] = [...DATASET, ...SYNTHETIC, ...BFF]

export function reasonPolicyInventory(): ReasonPolicyEntry[] {
  return REASON_POLICY_INVENTORY
}

/** Dataset/synthetic keys marked required — must match `reasonRequiredActions()`. */
export function inventoryRequiredDatasetActions(): string[] {
  return REASON_POLICY_INVENTORY.filter(
    (e) => e.surface === 'dataset' && e.reason === 'required',
  )
    .map((e) => e.key)
    .sort()
}

/** Dataset keys marked create-exempt. */
export function inventoryCreateExemptActions(): string[] {
  return REASON_POLICY_INVENTORY.filter(
    (e) =>
      e.surface === 'dataset' &&
      e.reason === 'exempt' &&
      !e.key.startsWith('privileged') &&
      e.id.startsWith('ds.'),
  )
    .map((e) => e.key)
    .sort()
}
