import type { RepoRole } from './authzTypes.js'

/** Minimum repo role per classified mutating action; the enforced source of truth. */
export const ACTION_MIN_ROLE: Record<string, RepoRole> = {
  'repo.delete': 'admin',
  'repo.metadata': 'admin',
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
 * Authorization-only action for push/pull transport routes. Audit classification
 * is unchanged (intermediate uploads stay `other`); authz treats them as data writes.
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

/**
 * Oxen HTTP path → minimum repo role (documentation view of the table above).
 * Enforcement lives in `ACTION_MIN_ROLE` / `minRoleForAction`; a test keeps them aligned.
 */
export const OXEN_PATH_ROLE_MAP: Array<{
  match: string
  methods: string[]
  minRole: 'read' | 'triage' | 'write' | 'maintain' | 'admin'
}> = [
  { match: 'GET/HEAD /api/version', methods: ['GET', 'HEAD'], minRole: 'read' },
  { match: 'GET /api/namespaces', methods: ['GET'], minRole: 'read' },
  { match: 'GET /api/repos/:ns', methods: ['GET'], minRole: 'read' },
  { match: 'GET /api/repos/:ns/:repo/**', methods: ['GET', 'HEAD'], minRole: 'read' },
  { match: 'POST /api/repos', methods: ['POST'], minRole: 'write' },
  { match: 'PUT /api/repos/:ns/:repo/file/**', methods: ['PUT'], minRole: 'write' },
  { match: 'POST /api/repos/:ns/:repo/branches', methods: ['POST'], minRole: 'write' },
  { match: 'POST /api/repos/:ns/:repo/workspaces/**', methods: ['POST', 'PUT'], minRole: 'write' },
  { match: 'POST /api/repos/:ns/:repo/merge*', methods: ['POST'], minRole: 'maintain' },
  { match: 'DELETE /api/repos/:ns/:repo/branches/**', methods: ['DELETE'], minRole: 'maintain' },
  { match: 'DELETE /api/repos/:ns/:repo', methods: ['DELETE'], minRole: 'admin' },
  {
    match: 'PATCH/PUT /api/repos/:ns/:repo (metadata)',
    methods: ['PATCH', 'PUT'],
    minRole: 'admin',
  },
  { match: 'POST/PUT/PATCH/DELETE other mutating', methods: ['POST', 'PUT', 'PATCH', 'DELETE'], minRole: 'admin' },
]

/** Mice workspace/checkout/store routes (not proxied to Oxen; see workspaces/routes.ts). */
export const WORKSPACE_PATH_ROLE_MAP: Array<{ match: string; methods: string[]; min: 'read' | 'write' | 'instance-admin' }> = [
  { match: 'GET /auth/workspaces?namespace&repo', methods: ['GET'], min: 'read' },
  { match: 'GET /auth/workspaces/:id[/changes|/files/**|/archive]', methods: ['GET'], min: 'read' },
  { match: 'POST /auth/workspaces', methods: ['POST'], min: 'write' },
  { match: 'POST /auth/workspaces/:id/retry', methods: ['POST'], min: 'write' },
  { match: 'DELETE /auth/workspaces/:id', methods: ['DELETE'], min: 'write' },
  { match: 'GET /auth/workspaces/:id/leases', methods: ['GET'], min: 'read' },
  { match: 'POST /auth/workspaces/:id/leases (mode=read)', methods: ['POST'], min: 'read' },
  { match: 'POST /auth/workspaces/:id/leases (mode=write)', methods: ['POST'], min: 'write' },
  { match: 'POST /auth/workspaces/:id/leases/:leaseId/renew|mount (lease owner, or instance admin)', methods: ['POST'], min: 'read' },
  { match: 'DELETE /auth/workspaces/:id/leases/:leaseId (owner; non-owner = force = instance admin)', methods: ['DELETE'], min: 'read' },
  { match: 'GET /auth/workspaces/capabilities', methods: ['GET'], min: 'instance-admin' },
  { match: 'GET /auth/checkouts?namespace&repo', methods: ['GET'], min: 'read' },
  { match: 'GET /auth/checkouts (no filter)', methods: ['GET'], min: 'instance-admin' },
  { match: 'GET /auth/checkouts/:ns/:repo/:commit', methods: ['GET'], min: 'read' },
  { match: 'POST /auth/checkouts', methods: ['POST'], min: 'write' },
  { match: 'DELETE /auth/checkouts/:ns/:repo/:commit', methods: ['DELETE'], min: 'instance-admin' },
  { match: 'POST /auth/store/gc|scrub', methods: ['POST'], min: 'instance-admin' },
]
