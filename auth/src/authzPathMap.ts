import type { RepoRole } from './authzTypes.js'

/**
 * Minimum repo role per classified mutating action; the enforced source of truth.
 * Documented in docs/authorization-routes.md (authzRoutesDocs.test.ts keeps the two in step).
 */
export const ACTION_MIN_ROLE: Record<string, RepoRole> = {
  'repo.delete': 'admin',
  'repo.metadata': 'admin',
  // Role floor only; 4-eyes self-merge is enforced in proxy/selfMerge (repositories).
  merge: 'maintain',
  'branch.delete': 'maintain',
  'file.write': 'write',
  'file.delete': 'write',
  'branch.create': 'write',
  'branch.update': 'write',
  'repo.create': 'write',
  push: 'write',
  'versions.query': 'read',
}

/**
 * Authorization-only action for push/pull transport routes. Audit may use
 * `commit.upload` / `commit.publish`; authz still treats the transport as `push`.
 */
export function authzActionForPath(method: string, pathname: string, action: string): string {
  const m = method.toUpperCase()
  const rest = pathname.replace(/\/+$/, '').match(/^\/api\/repos\/[^/]+\/[^/]+\/(commits|versions)(\/.*)?$/)
  if (!rest) return action
  if (rest[1] === 'versions' && m === 'QUERY' && !rest[2]) return 'versions.query'
  if (m === 'GET' || m === 'HEAD') return action
  return 'push'
}

/** Actions sharing a prefix (all `workspace.*`) map to one role. */
export const ACTION_PREFIX_MIN_ROLE: Array<{ prefix: string; minRole: RepoRole }> = [
  { prefix: 'workspace', minRole: 'write' },
]

export function minRoleForAction(action: string): RepoRole | undefined {
  const exact = ACTION_MIN_ROLE[action]
  if (exact) return exact
  return ACTION_PREFIX_MIN_ROLE.find((p) => action.startsWith(p.prefix))?.minRole
}

/**
 * GET/HEAD /api paths that need no repo scope. Everything else without a
 * namespace and repo is denied (default-deny).
 */
export const UNSCOPED_GET_ALLOWLIST = [
  '/api/version',
  '/api/health',
  '/api/oxen_version',
  '/api/namespaces',
  '/api/namespaces/:ns',
  '/api/repos/:ns',
] as const
