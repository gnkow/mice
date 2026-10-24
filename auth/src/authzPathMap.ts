/**
 * Oxen HTTP path → minimum repo role (Mice BFF AuthZ).
 * Keep in sync with `requiredRepoRoleForRequest` in authz.ts.
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
