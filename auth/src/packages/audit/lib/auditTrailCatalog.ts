/**
 * Audit trail policy (#154): which actions belong on the ledger, and what Auditors see by default.
 *
 * - **always** — written to immudb (mutations fail-closed). Investigation signal.
 * - **summary** — still on the ledger as a compact US13-style event (not per-row noise).
 * - **omit** — never written (producer-side only: bootstrap/seed). Not listed here as actions.
 *
 * Auditor visibility is independent: Security may still need login/session events on the ledger
 * while Auditors investigating data changes hide them by default (admin Settings override).
 */

import { knownAuditActions } from './auditLabels.js'

export type TrailWrite = 'always' | 'summary'
export type AuditorDefaultVisibility = 'show' | 'hide'

export type AuditTrailEntry = {
  action: string
  /** Ledger write policy. */
  trail: TrailWrite
  /** Default Auditor list/export visibility (admin can override). */
  auditor: AuditorDefaultVisibility
  /** Short rationale for trail + visibility. */
  why: string
}

/**
 * Producer-side **omit** (not catalogue actions): never appendAudit.
 * Documented here so the catalog decision is complete.
 */
export const TRAIL_OMIT_PRODUCERS: readonly { name: string; why: string }[] = [
  {
    name: 'RBAC bootstrap / null-actor grants',
    why: 'System seed, not a human mutation; history tables remain SoT for grants.',
  },
  {
    name: 'seed-dev restore-test pass',
    why: 'Local unlock of regulated merges; durable in Postgres, not a GxP mutation.',
  },
]

/** Compact table: action → trail / auditor default / why. */
const ENTRIES: readonly AuditTrailEntry[] = [
  // —— GxP data / change (always + show) ——
  e('file.write', 'always', 'show', 'Dataset mutation'),
  e('file.delete', 'always', 'show', 'Dataset mutation'),
  e('branch.create', 'always', 'show', 'Dataset mutation'),
  e('branch.update', 'always', 'show', 'Dataset mutation'),
  e('branch.delete', 'always', 'show', 'Dataset mutation'),
  e('commit.publish', 'always', 'show', 'Dataset mutation'),
  e('merge', 'always', 'show', 'Dataset mutation'),
  e('merge_request.open', 'always', 'show', 'Merge request lifecycle'),
  e('merge_request.resync', 'always', 'show', 'Merge request lifecycle'),
  e('merge_request.cancel', 'always', 'show', 'Merge request lifecycle'),
  e('merge_request.reopen', 'always', 'show', 'Merge request lifecycle'),
  e('merge_request.reopen_denied', 'always', 'show', 'Merge request refuse'),
  e('merge_request.reject', 'always', 'show', 'Merge request lifecycle'),
  e('merge_request.reject_denied', 'always', 'show', 'Merge request refuse'),
  e('merge_request.complete', 'always', 'show', 'Merge into validated branch'),
  e('merge_request.complete_denied', 'always', 'show', 'Merge complete refuse'),
  e('esign.execute', 'always', 'show', 'Signature ceremony (binding for later mutation)'),
  e(
    'bff.mutation',
    'always',
    'show',
    'Legacy rows only: new Intents never use it (routes must name their operation). Kept visible so no ledger entry is hidden',
  ),
  e('repo.create', 'always', 'show', 'Repository lifecycle'),
  e('repo.delete', 'always', 'show', 'Repository lifecycle'),
  e('repo.metadata', 'always', 'show', 'Repository settings'),
  e('repo.rename', 'always', 'show', 'Repository lifecycle'),
  e('repo.settings.update', 'always', 'show', 'Repository settings'),
  e('repo.transfer', 'always', 'show', 'Repository transfer'),
  e('repo.transfer.accept', 'always', 'show', 'Repository transfer'),
  e('repo.transfer.reject', 'always', 'show', 'Repository transfer'),
  e('repo.transfer.cancel', 'always', 'show', 'Repository transfer'),
  e('repo.collaborator.set', 'always', 'show', 'Access change'),
  e('repo.collaborator.remove', 'always', 'show', 'Access change'),
  e('approver.grant', 'always', 'show', 'SoD / merge gate'),
  e('approver.revoke', 'always', 'show', 'SoD / merge gate'),
  e('validated_branch.mark', 'always', 'show', 'Validated branch registry'),
  e('validated_branch.unmark', 'always', 'show', 'Validated branch registry'),
  e('commit.disposition', 'always', 'show', 'Commit QC disposition map'),
  e('esign.created', 'always', 'show', 'Part 11 signature'),
  e('esign.failed', 'always', 'show', 'Signature ceremony failure'),
  e('esign.revoked', 'always', 'show', 'Signature revocation'),
  e('esign.revoke_denied', 'always', 'show', 'Revoke refused'),
  e('esign.revocation_reverted', 'always', 'show', 'Revocation reverted'),
  e('esign.revocation_revert_denied', 'always', 'show', 'Revert refused'),
  e('workspace.create', 'always', 'show', 'Workspace lifecycle'),
  e('workspace.delete', 'always', 'show', 'Workspace lifecycle'),
  e('workspace.commit', 'always', 'show', 'Dataset mutation'),
  e('workspace.merge', 'always', 'show', 'Dataset mutation'),
  e('workspace.file.write', 'always', 'show', 'Staging write (pre-commit)'),
  e('workspace.file.delete', 'always', 'show', 'Staging delete'),
  e('workspace.lease.force_release', 'always', 'show', 'Security-relevant lease break'),
  e('job.submit', 'always', 'show', 'Job lifecycle'),
  e('job.complete', 'always', 'show', 'Job lifecycle'),
  e('job.fail', 'always', 'show', 'Job lifecycle'),
  e('job.cancel', 'always', 'show', 'Job lifecycle'),
  e('job.publish', 'always', 'show', 'Job metadata publish'),
  e('meta.set', 'always', 'show', 'Metadata mutation'),
  e('meta.delete', 'always', 'show', 'Metadata mutation'),
  e('namespace.create', 'always', 'show', 'Namespace lifecycle'),
  e('namespace.settings.update', 'always', 'show', 'Namespace settings'),
  e('namespace.delete', 'always', 'show', 'Namespace lifecycle'),
  e('namespace.member.set', 'always', 'show', 'Access change'),
  e('namespace.member.remove', 'always', 'show', 'Access change'),
  e('custom-role.namespace.create', 'always', 'show', 'AuthZ role'),
  e('custom-role.namespace.update', 'always', 'show', 'AuthZ role'),
  e('custom-role.namespace.delete', 'always', 'show', 'AuthZ role'),
  e('custom-role.repo.create', 'always', 'show', 'AuthZ role'),
  e('custom-role.repo.update', 'always', 'show', 'AuthZ role'),
  e('custom-role.repo.delete', 'always', 'show', 'AuthZ role'),
  e('access-request.submit', 'always', 'show', 'Access workflow'),
  e('access-request.approve', 'always', 'show', 'Access workflow'),
  e('access-request.deny', 'always', 'show', 'Access workflow'),
  e('role.assign', 'always', 'show', 'Instance role'),
  e('role.revoke', 'always', 'show', 'Instance role'),
  e('permission.grant', 'always', 'show', 'Instance permission'),
  e('permission.revoke', 'always', 'show', 'Instance permission'),
  e('access.grant.role', 'always', 'show', 'Direct grant'),
  e('access.grant.permissions', 'always', 'show', 'Direct grant'),
  e('training.update', 'always', 'show', 'Training gate'),
  e('instance.settings.update', 'always', 'show', 'Instance config'),
  e('instance.admin.add', 'always', 'show', 'Admin SoD'),
  e('instance.admin.remove', 'always', 'show', 'Admin SoD'),
  e('instance.permissions.update', 'always', 'show', 'Instance permissions'),
  e('token.revoke', 'always', 'show', 'Credential revocation'),
  e('session.revoke', 'always', 'show', 'Session revocation'),
  e('lineage.rebuild', 'always', 'show', 'Lineage mutation'),
  e('audit.break.acknowledge', 'always', 'show', 'Integrity incident'),
  e('audit.visibility.update', 'always', 'show', 'Who can see which events'),
  e('audit.export', 'summary', 'show', 'US13 audit-of-audit (export)'),
  e('audit.checkpoint', 'always', 'show', 'Evidence / IQP pin'),

  // —— Explicit call-outs (#154): auth / session / browse ——
  e(
    'auth.login',
    'always',
    'hide',
    'Security trail; hide from Auditors by default (not a data mutation). Ledger kept.',
  ),
  e('auth.login.failed', 'always', 'hide', 'Security trail; Auditor noise by default'),
  e('auth.logout', 'always', 'hide', 'Session end; Auditor noise by default'),
  e('auth.reauth', 'always', 'hide', 'Step-up success; hide unless investigating MFA'),
  e('auth.reauth.failed', 'always', 'hide', 'Step-up failure; hide by default'),
  e(
    'audit.browse',
    'summary',
    'hide',
    'US13 audit-of-audit summary; hide by default so browse does not drown mutations',
  ),

  // —— Operational noise: always on ledger, hide from Auditors ——
  e('token.refresh', 'always', 'hide', 'CLI refresh chatter'),
  e('token.create', 'always', 'hide', 'Token mint (revoke stays show)'),
  e('device.approve', 'always', 'hide', 'CLI device flow'),
  e('device.deny', 'always', 'hide', 'CLI device flow'),
  e('device.redeem', 'always', 'hide', 'CLI device flow'),
  e('session.create', 'always', 'hide', 'Desktop session lifecycle'),
  e('session.ready', 'always', 'hide', 'Desktop session lifecycle'),
  e('session.fail', 'always', 'hide', 'Desktop session lifecycle'),
  e('session.connect', 'always', 'hide', 'Desktop session lifecycle'),
  e('session.disconnect', 'always', 'hide', 'Desktop session lifecycle'),
  e('session.stop', 'always', 'hide', 'Desktop session lifecycle'),
  e('session.retry', 'always', 'hide', 'Desktop session lifecycle'),
  e('session.remount', 'always', 'hide', 'Desktop session lifecycle'),
  e('session.destroy', 'always', 'hide', 'Desktop session lifecycle'),
  e('session.sync', 'always', 'hide', 'Desktop session lifecycle'),
  e('session.mounts.update', 'always', 'hide', 'Desktop session lifecycle'),
  e('session.evict', 'always', 'hide', 'Cap eviction (ops)'),
  e('workspace.lease.acquire', 'always', 'hide', 'Lease chatter'),
  e('workspace.lease.release', 'always', 'hide', 'Lease chatter'),
  e('checkout.build', 'always', 'hide', 'Store maintenance'),
  e('checkout.evict', 'always', 'hide', 'Store maintenance'),
  e('checkout.corrupt', 'always', 'hide', 'Store maintenance'),
  e('store.gc', 'always', 'hide', 'Store maintenance'),
  e('store.scrub', 'always', 'hide', 'Store maintenance'),
  e('store.full', 'always', 'hide', 'Store capacity signal'),
  e('workspace.retry', 'always', 'hide', 'Prep retry'),
  e('job.sync', 'always', 'hide', 'Job metadata sync chatter'),
  e('acl_bypass_read', 'always', 'hide', 'Auditor ACL bypass read volume'),
  e('versions.query', 'always', 'hide', 'Read-only dataset probe'),
  e('announcement.create', 'always', 'hide', 'Instance UX'),
  e('announcement.update', 'always', 'hide', 'Instance UX'),
  e('announcement.delete', 'always', 'hide', 'Instance UX'),
  e('instance.group_binding.check', 'always', 'hide', 'Diagnostics'),
  e('directory.sync.failed', 'always', 'hide', 'Directory ops'),
  e('directory.sync.stale', 'always', 'hide', 'Directory ops'),
  e(
    'commit.upload',
    'always',
    'hide',
    'Push transport chunks; publish/complete stays visible',
  ),
  e('request.rejected', 'always', 'hide', 'Malformed / policy refuse volume'),
  e('request.cross_site_rejected', 'always', 'hide', 'CSRF refuse volume'),
]

function e(
  action: string,
  trail: TrailWrite,
  auditor: AuditorDefaultVisibility,
  why: string,
): AuditTrailEntry {
  return { action, trail, auditor, why }
}

const BY_ACTION: ReadonlyMap<string, AuditTrailEntry> = new Map(ENTRIES.map((x) => [x.action, x]))

/** Full trail catalog entries (stable order). */
export function auditTrailCatalog(): readonly AuditTrailEntry[] {
  return ENTRIES
}

export function auditTrailEntry(action: string): AuditTrailEntry | undefined {
  return BY_ACTION.get(action)
}

/**
 * Actions hidden from Auditors by default (still on the ledger).
 * Source of truth for Settings → Audit Visibility defaults.
 */
export function defaultAuditorHiddenFromCatalog(): string[] {
  const known = new Set(knownAuditActions().map((a) => a.value))
  return ENTRIES.filter((x) => x.auditor === 'hide' && known.has(x.action))
    .map((x) => x.action)
    .sort()
}

/**
 * Consistency: every known UI catalogue action has a trail policy, and hide-set ⊆ known.
 * Throws with a bullet list when incomplete (used by tests).
 */
export function assertTrailCatalogComplete(): void {
  const problems: string[] = []
  const known = knownAuditActions().map((a) => a.value)
  for (const value of known) {
    if (!BY_ACTION.has(value)) problems.push(`missing trail policy for ${value}`)
  }
  for (const entry of ENTRIES) {
    if (entry.trail !== 'always' && entry.trail !== 'summary') {
      problems.push(`${entry.action} has invalid trail ${String(entry.trail)}`)
    }
    if (entry.auditor !== 'show' && entry.auditor !== 'hide') {
      problems.push(`${entry.action} has invalid auditor default ${String(entry.auditor)}`)
    }
  }
  // US13 / fail-closed invariants
  for (const mustShow of ['file.write', 'merge', 'esign.revoked', 'audit.export', 'audit.visibility.update', 'bff.mutation']) {
    const row = BY_ACTION.get(mustShow)
    if (!row) problems.push(`missing required action ${mustShow}`)
    else if (row.auditor === 'hide') problems.push(`${mustShow} must stay Auditor-visible by default`)
  }
  for (const mustHide of [
    'auth.login',
    'auth.logout',
    'audit.browse',
    'session.create',
  ]) {
    const row = BY_ACTION.get(mustHide)
    if (!row) problems.push(`missing call-out action ${mustHide}`)
    else if (row.auditor !== 'hide') problems.push(`${mustHide} must default-hide for Auditors`)
    else if (row.trail === undefined) problems.push(`${mustHide} must remain on the ledger`)
  }
  const browse = BY_ACTION.get('audit.browse')
  if (browse && browse.trail !== 'summary') {
    problems.push('audit.browse must be summary (US13)')
  }
  if (problems.length) throw new Error(`Audit trail catalog incomplete:\n- ${problems.join('\n- ')}`)
}
