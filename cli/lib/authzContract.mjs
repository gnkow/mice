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
/** Formal instance roles for RBAC (GET /auth/me/authz). */
export const INSTANCE_ROLES = ['external', 'user', 'manager', 'auditor', 'admin'];
export const NAMESPACE_ROLES = ['owner', 'member'];
export const REPO_ROLES = ['read', 'triage', 'write', 'maintain', 'admin'];
/**
 * Orthogonal grant, not a rank in REPO_ROLES: assigned by a namespace Owner at namespace or
 * repository scope, and required to sign a merge into a validated branch.
 */
export const APPROVER_ROLE = 'approver';
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
export function isInstanceRole(v) {
    return typeof v === 'string' && INSTANCE_ROLES.includes(v);
}
export function isRepoRole(v) {
    return typeof v === 'string' && REPO_ROLES.includes(v);
}
function isStringArray(v) {
    return Array.isArray(v) && v.every((x) => typeof x === 'string');
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
    if (r.role !== null && !isInstanceRole(r.role))
        return null;
    if (!isStringArray(r.effectivePermissions))
        return null;
    if (!isStringArray(r.permissionCatalog) || r.permissionCatalog.length === 0)
        return null;
    const out = {
        enforce: r.enforce,
        pending: r.pending,
        role: r.role,
        effectivePermissions: r.effectivePermissions,
        permissionCatalog: r.permissionCatalog,
    };
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
