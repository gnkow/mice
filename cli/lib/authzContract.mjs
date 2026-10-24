// GENERATED from auth/src/authzContract.ts by scripts/sync-authz-contract.mjs. Do not edit.
// Authz contract: single source of truth for names shared by auth, web and the CLI.
// Edit only auth/src/authzContract.ts, then run `node scripts/sync-authz-contract.mjs`
// to refresh web/src/lib/authzContract.ts and cli/lib/authzContract.mjs (drift is a test failure).
// Keep this file dependency-free and limited to erasable TypeScript syntax.
export const INSTANCE_PERMISSIONS = [
    'create_namespace',
    'view_audit',
    'view_lineage',
    'manage_own_tokens',
    'cli_device_approve',
    'session_create',
    'session_connect',
    'session_admin',
];
export const NAMESPACE_ROLES = ['owner', 'member'];
export const REPO_ROLES = ['read', 'triage', 'write', 'maintain', 'admin'];
export const NAMESPACE_CAPABILITIES = [
    'manage_members',
    'manage_settings',
    'manage_custom_roles',
    'create_repos',
    'view_audit',
    'view_lineage',
    'review_access_requests',
    'delete_namespace',
];
export const REPO_FINE_PERMISSIONS = [
    'contents_read',
    'contents_write',
    'workspaces',
    'merge',
    'delete_branch',
    'manage_collaborators',
    'manage_repo_metadata',
    'repo_delete',
    'other_mutate',
    'job_submit',
    'job_read',
    'job_cancel',
    'job_complete',
    'lineage_read',
    'lineage_rebuild',
];
export function isInstancePermission(v) {
    return typeof v === 'string' && INSTANCE_PERMISSIONS.includes(v);
}
export function isRepoRole(v) {
    return typeof v === 'string' && REPO_ROLES.includes(v);
}
/** Validate an untrusted /auth/me/authz payload; null when it does not match the contract. */
export function parseAuthzMe(raw) {
    if (typeof raw !== 'object' || raw === null)
        return null;
    const r = raw;
    if (typeof r.enforce !== 'boolean')
        return null;
    if (typeof r.pending !== 'boolean')
        return null;
    if (typeof r.instanceAdmin !== 'boolean')
        return null;
    if (typeof r.hasAnyGrant !== 'boolean')
        return null;
    if (typeof r.permissions !== 'object' || r.permissions === null)
        return null;
    const perms = r.permissions;
    const permissions = {};
    for (const p of INSTANCE_PERMISSIONS) {
        if (typeof perms[p] !== 'boolean')
            return null;
        permissions[p] = perms[p];
    }
    const out = {
        enforce: r.enforce,
        pending: r.pending,
        instanceAdmin: r.instanceAdmin,
        permissions,
        hasAnyGrant: r.hasAnyGrant,
    };
    if (r.instancePermissionCatalog !== undefined) {
        if (!Array.isArray(r.instancePermissionCatalog))
            return null;
        if (!r.instancePermissionCatalog.every(isInstancePermission))
            return null;
        out.instancePermissionCatalog = r.instancePermissionCatalog;
    }
    if (r.trainingCompleted !== undefined) {
        if (typeof r.trainingCompleted !== 'boolean')
            return null;
        out.trainingCompleted = r.trainingCompleted;
    }
    if (r.requireTraining !== undefined) {
        if (typeof r.requireTraining !== 'boolean')
            return null;
        out.requireTraining = r.requireTraining;
    }
    return out;
}
