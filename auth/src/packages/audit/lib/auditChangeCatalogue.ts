import { knownAuditActions } from './auditLabels.js'

/**
 * What an audit event's `change` must look like for an action.
 *
 * - `mutation`: a successful outcome MUST carry a non-empty change (use `requireAuditChange` /
 *   `proxyMutationChange`; a no-op is refused with `NoChangeError`).
 * - `non_mutation`: empty change expected (reads, checks, denials, failures, signals). A non-empty
 *   change is allowed where a side effect is real (e.g. `store.scrub` quarantining blobs).
 * - `transport`: an intermediate step that moves no version by itself (`commit.upload`); empty is
 *   correct and documented, the version moves at `commit.publish`.
 * - `staging`: workspace files not yet committed; the change uses file path / hash deltas when
 *   available (`proxyMutationChange` never returns empty for an answered staging request).
 */
export type AuditChangeKind = 'mutation' | 'non_mutation' | 'transport' | 'staging'

export const AUDIT_CHANGE_KINDS: readonly AuditChangeKind[] = ['mutation', 'non_mutation', 'transport', 'staging']

const MUTATION = [
  // Files, branches, commits
  'file.write', 'file.delete',
  'branch.create', 'branch.update', 'branch.delete',
  'commit.publish', 'merge',
  // Repositories
  'repo.create', 'repo.delete', 'repo.metadata', 'repo.rename', 'repo.settings.update',
  'repo.transfer', 'repo.transfer.accept', 'repo.transfer.reject', 'repo.transfer.cancel',
  'repo.collaborator.set', 'repo.collaborator.remove',
  'approver.grant', 'approver.revoke',
  'validated_branch.mark', 'validated_branch.unmark', 'commit.disposition',
  // Signatures (only the outcomes that change a signature record)
  'esign.created', 'esign.execute', 'esign.revoked', 'esign.revocation_reverted',
  // Merge requests
  'merge_request.open', 'merge_request.resync', 'merge_request.cancel', 'merge_request.reopen',
  'merge_request.reject', 'merge_request.reject_reverted', 'merge_request.complete',
  // Workspaces and the checkout store
  'workspace.create', 'workspace.delete', 'workspace.commit', 'workspace.merge', 'workspace.retry',
  'workspace.lease.acquire', 'workspace.lease.release', 'workspace.lease.force_release',
  'checkout.build', 'checkout.evict', 'checkout.corrupt', 'store.gc',
  // Jobs, metadata
  'job.submit', 'job.complete', 'job.fail', 'job.cancel', 'job.sync', 'job.publish', 'job.result_commit',
  'meta.set', 'meta.delete',
  // Desktop sessions
  'session.create', 'session.ready', 'session.fail', 'session.connect', 'session.disconnect',
  'session.stop', 'session.retry', 'session.mounts.update', 'session.remount', 'session.destroy', 'session.sync',
  // Namespaces and roles
  'namespace.create', 'namespace.settings.update', 'namespace.delete',
  'namespace.member.set', 'namespace.member.remove',
  'custom-role.namespace.create', 'custom-role.namespace.update', 'custom-role.namespace.delete',
  'custom-role.repo.create', 'custom-role.repo.update', 'custom-role.repo.delete',
  // Access
  'access-request.submit', 'access-request.approve', 'access-request.deny',
  'role.assign', 'role.revoke', 'permission.grant', 'permission.revoke',
  'access.grant.role', 'access.grant.permissions', 'training.update',
  'access-review.sign',
  // Instance
  'instance.settings.update', 'instance.admin.add', 'instance.admin.remove',
  'instance.permissions.update', 'instance.permissions.expire',
  'announcement.create', 'announcement.update', 'announcement.delete',
  // Tokens, devices, sessions
  'token.create', 'token.refresh', 'token.revoke',
  'device.approve', 'device.deny', 'device.redeem',
  'session.revoke', 'session.evict', 'session.role_change',
  // Account lifecycle
  'auth.suspend.request', 'auth.suspend.confirm', 'auth.suspend.self',
  'auth.reenable.automatic', 'auth.reenable.confirmed',
  // Audit, lineage
  'lineage.rebuild', 'audit.break.acknowledge', 'audit.visibility.update',
  // Admin, system, keys
  'admin.revoke_all', 'admin.suspend_initiated', 'admin.suspend_confirmed',
  'admin.mice_suspension.set', 'admin.mice_suspension.lift',
  'idp_baseline.established',
  'seal_key.rotated', 'seal_key.emergency_rotation',
  'system.regulated_config.change',
] as const

const NON_MUTATION = [
  // Signature failures and denials (the signature record did not change)
  'esign.failed', 'esign.revoke_denied', 'esign.revocation_revert_denied',
  'signature.blocked_by_drift', 'signature.hash_mismatch', 'signature.mfa_required',
  // Merge request denials
  'merge_request.reopen_denied', 'merge_request.reject_denied', 'merge_request.complete_denied',
  // Checkout store signals / verification (store.scrub records a change only when it quarantines)
  'store.scrub', 'store.full',
  // Reads, queries, rejections
  'repo.read', 'repo.list', 'versions.query', 'meta.read', 'lineage.read', 'unclassified',
  'acl_bypass_read', 'request.rejected', 'request.cross_site_rejected', 'request.missing_origin',
  // Legacy placeholder: historic rows only; never written as an Intent (see auditIntentAction.ts)
  'bff.mutation',
  // Authentication events
  'auth.login', 'auth.login.failed', 'auth.reauth', 'auth.reauth.failed', 'auth.logout', 'auth.suspended',
  'auth.session.groups.refresh',
  // Directory and IdP checks
  'directory.sync.failed', 'directory.sync.stale',
  'instance.group_binding.check', 'admin.idp_baseline_check', 'admin.idp_baseline_check_failed',
  'idp_drift.check_performed',
  // Audit reads / evidence
  'audit.export', 'audit.browse', 'audit.checkpoint',
  'access-review.read', 'access-review.generate',
  // System checks and reports
  'system.restore_test.passed', 'system.integrity_check', 'system.release_manifest.check',
  'system.signed_record_report', 'system.backup_target.check', 'system.traceability_matrix.release',
  'system.regulated_config.start',
] as const

const TRANSPORT = ['commit.upload'] as const

const STAGING = ['workspace.file.write', 'workspace.file.delete'] as const

const BY_KIND: Record<AuditChangeKind, readonly string[]> = {
  mutation: MUTATION,
  non_mutation: NON_MUTATION,
  transport: TRANSPORT,
  staging: STAGING,
}

/** Every classified action → its change kind. */
export const AUDIT_CHANGE_KIND: Readonly<Record<string, AuditChangeKind>> = Object.freeze(
  Object.fromEntries(
    AUDIT_CHANGE_KINDS.flatMap((kind) => BY_KIND[kind].map((action) => [action, kind] as const)),
  ),
)

/** Mutations that still cannot capture a real change (must stay empty). Keep this empty. */
export const AUDIT_CHANGE_CAPTURE_GAPS: ReadonlySet<string> = new Set()

/** The kind of an action, or `undefined` when it is not classified. */
export function auditChangeKind(action: string): AuditChangeKind | undefined {
  return Object.prototype.hasOwnProperty.call(AUDIT_CHANGE_KIND, action) ? AUDIT_CHANGE_KIND[action] : undefined
}

/** All actions of a kind, in catalogue order. */
export function auditActionsOfKind(kind: AuditChangeKind): string[] {
  return [...BY_KIND[kind]]
}

/**
 * Throws, listing every problem, unless the catalogue is consistent:
 * every `knownAuditActions()` value has a kind, no action is classified twice, every kind is valid,
 * and every capture gap is a classified mutation.
 */
export function assertCatalogueComplete(): void {
  const problems: string[] = []

  const seen = new Map<string, AuditChangeKind>()
  for (const kind of AUDIT_CHANGE_KINDS) {
    for (const action of BY_KIND[kind]) {
      const prior = seen.get(action)
      if (prior) problems.push(`${action} is classified twice (${prior}, ${kind})`)
      else seen.set(action, kind)
    }
  }

  for (const [action, kind] of Object.entries(AUDIT_CHANGE_KIND)) {
    if (!AUDIT_CHANGE_KINDS.includes(kind)) problems.push(`${action} has unknown kind ${String(kind)}`)
  }

  for (const { value } of knownAuditActions()) {
    if (auditChangeKind(value) === undefined) problems.push(`${value} has no change kind`)
  }

  for (const action of AUDIT_CHANGE_CAPTURE_GAPS) {
    if (auditChangeKind(action) !== 'mutation') problems.push(`capture gap ${action} is not a mutation`)
  }

  if (problems.length > 0) throw new Error(`Audit change catalogue incomplete:\n- ${problems.join('\n- ')}`)
}
