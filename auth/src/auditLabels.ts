export type AuditActionInfo = { value: string; label: string; group: string }

const CATALOGUE: Array<[string, string, string]> = [
  ['file.write', 'File saved', 'Files'],
  ['file.delete', 'File deleted', 'Files'],
  ['branch.create', 'Branch created', 'Branches & merges'],
  ['branch.update', 'Branch updated', 'Branches & merges'],
  ['branch.delete', 'Branch deleted', 'Branches & merges'],
  ['branch.other', 'Branch changed', 'Branches & merges'],
  ['commit.publish', 'Commit published', 'Branches & merges'],
  ['merge', 'Branches merged', 'Branches & merges'],
  ['repo.create', 'Repository created', 'Repositories'],
  ['repo.delete', 'Repository deleted', 'Repositories'],
  ['repo.metadata', 'Repository settings changed', 'Repositories'],
  ['repo.collaborator.set', 'Repository collaborator added or changed', 'Repositories'],
  ['repo.collaborator.remove', 'Repository collaborator removed', 'Repositories'],
  ['approver.grant', 'Approver role assigned', 'Repositories'],
  ['approver.revoke', 'Approver role removed', 'Repositories'],
  ['workspace.create', 'Workspace created', 'Workspaces'],
  ['workspace.delete', 'Workspace deleted', 'Workspaces'],
  ['workspace.commit', 'Workspace committed', 'Workspaces'],
  ['workspace.merge', 'Workspace merged', 'Workspaces'],
  ['workspace.file.write', 'Workspace file saved', 'Workspaces'],
  ['workspace.file.delete', 'Workspace file deleted', 'Workspaces'],
  ['workspace.other', 'Workspace changed', 'Workspaces'],
  ['workspace.lease.acquire', 'Workspace lease acquired', 'Workspaces'],
  ['workspace.lease.release', 'Workspace lease released', 'Workspaces'],
  ['workspace.lease.force_release', 'Workspace lease force-released', 'Workspaces'],
  ['checkout.build', 'Checkout built', 'Workspaces'],
  ['checkout.evict', 'Checkout evicted', 'Workspaces'],
  ['checkout.corrupt', 'Checkout corrupt', 'Workspaces'],
  ['store.gc', 'Checkout store GC', 'Workspaces'],
  ['store.full', 'Checkout store full', 'Workspaces'],
  ['job.submit', 'Job submitted', 'Jobs'],
  ['meta.set', 'Metadata updated', 'Metadata'],
  ['meta.delete', 'Metadata removed', 'Metadata'],
  ['job.complete', 'Job completed', 'Jobs'],
  ['job.fail', 'Job failed', 'Jobs'],
  ['job.cancel', 'Job cancelled', 'Jobs'],
  ['job.sync', 'Job metadata synced', 'Jobs'],
  ['job.publish', 'Job metadata published', 'Jobs'],
  ['session.create', 'Session created', 'Sessions'],
  ['session.ready', 'Session ready', 'Sessions'],
  ['session.fail', 'Session failed', 'Sessions'],
  ['session.connect', 'Session connected', 'Sessions'],
  ['session.disconnect', 'Session disconnected', 'Sessions'],
  ['session.stop', 'Session stopped', 'Sessions'],
  ['session.retry', 'Session retried', 'Sessions'],
  ['session.mounts.update', 'Session mounts updated', 'Sessions'],
  ['session.remount', 'Session workspace remounted', 'Sessions'],
  ['session.destroy', 'Session destroyed', 'Sessions'],
  ['session.sync', 'Session files synced', 'Sessions'],
  ['namespace.create', 'Namespace created', 'Namespaces'],
  ['namespace.settings.update', 'Namespace settings changed', 'Namespaces'],
  ['namespace.delete', 'Namespace deleted', 'Namespaces'],
  ['namespace.member.set', 'Namespace member added or changed', 'Namespaces'],
  ['namespace.member.remove', 'Namespace member removed', 'Namespaces'],
  ['custom-role.namespace.create', 'Namespace role created', 'Custom roles'],
  ['custom-role.namespace.update', 'Namespace role changed', 'Custom roles'],
  ['custom-role.namespace.delete', 'Namespace role deleted', 'Custom roles'],
  ['custom-role.repo.create', 'Repository role created', 'Custom roles'],
  ['custom-role.repo.update', 'Repository role changed', 'Custom roles'],
  ['custom-role.repo.delete', 'Repository role deleted', 'Custom roles'],
  ['access-request.submit', 'Access requested', 'Access'],
  ['access-request.approve', 'Access request approved', 'Access'],
  ['access-request.deny', 'Access request denied', 'Access'],
  ['role.assign', 'Role assigned', 'Access'],
  ['role.revoke', 'Role revoked', 'Access'],
  ['permission.grant', 'Permission granted', 'Access'],
  ['permission.revoke', 'Permission revoked', 'Access'],
  ['access.grant.role', 'Role granted directly', 'Access'],
  ['access.grant.permissions', 'Permissions granted directly', 'Access'],
  ['training.update', 'Training status changed', 'Access'],
  ['instance.settings.update', 'Instance settings changed', 'Instance'],
  ['instance.admin.add', 'Instance admin added', 'Instance'],
  ['instance.admin.remove', 'Instance admin removed', 'Instance'],
  ['instance.permissions.update', 'Instance permissions changed', 'Instance'],
  ['instance.group_binding.check', 'Group binding mode checked', 'Instance'],
  ['announcement.create', 'Announcement published', 'Instance'],
  ['announcement.update', 'Announcement updated', 'Instance'],
  ['announcement.delete', 'Announcement deleted', 'Instance'],
  ['token.create', 'Access token created', 'Tokens & CLI'],
  ['session.revoke', 'Sessions revoked', 'Access'],
  ['session.evict', 'Session evicted (cap exceeded)', 'Access'],
  ['directory.sync.failed', 'Directory sync failed', 'Access'],
  ['directory.sync.stale', 'Directory sync stale', 'Access'],
  ['token.revoke', 'Access token revoked', 'Tokens & CLI'],
  ['device.approve', 'CLI login approved', 'Tokens & CLI'],
  ['device.deny', 'CLI login denied', 'Tokens & CLI'],
  ['device.redeem', 'CLI login completed', 'Tokens & CLI'],
  ['auth.login', 'Signed in', 'Account'],
  ['auth.login.failed', 'Sign-in refused', 'Account'],
  ['auth.reauth', 'Re-authenticated', 'Account'],
  ['auth.reauth.failed', 'Re-authentication failed', 'Account'],
  ['auth.logout', 'Signed out', 'Account'],
  ['lineage.rebuild', 'Lineage rebuilt', 'Data lineage'],
  ['audit.export', 'Audit log exported', 'Audit'],
  ['audit.checkpoint', 'Audit checkpoint signed', 'Audit'],
  ['audit.break.acknowledge', 'Audit chain break acknowledged', 'Audit'],
  ['acl_bypass_read', 'Auditor ACL bypass read', 'Audit'],
  ['request.rejected', 'Request rejected (unclassifiable body)', 'Audit'],
  ['request.cross_site_rejected', 'Cross-site request rejected', 'Audit'],
  ['other', 'Other change', 'Other'],
]

const BY_VALUE = new Map(
  CATALOGUE.map(([value, label, group]) => [value, { value, label, group }]),
)

export function knownAuditActions(): AuditActionInfo[] {
  return [...BY_VALUE.values()]
}

function humanize(action: string): string {
  const text = action.replace(/[._-]+/g, ' ').trim()
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : 'Unknown'
}

export function auditActionInfo(action: string): AuditActionInfo {
  return (
    BY_VALUE.get(action) ?? { value: action, label: humanize(action), group: 'Other' }
  )
}

export function auditActionLabel(action: string): string {
  return auditActionInfo(action).label
}
