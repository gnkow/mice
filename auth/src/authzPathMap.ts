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
