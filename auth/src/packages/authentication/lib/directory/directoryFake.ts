import type { Directory, DirectoryGroupHit, DirectoryUserHit, DirectoryUserStatus } from './directoryTypes.js'

/** In-memory Directory for tests. */
export function createFakeDirectory(opts: {
  configured?: boolean
  issuer?: string
  users?: DirectoryUserHit[]
  groups?: DirectoryGroupHit[]
  statuses?: Record<string, DirectoryUserStatus>
  userGroups?: Record<string, string[]>
} = {}): Directory {
  const has = (q: string, ...fields: string[]) =>
    fields.some((f) => f.toLowerCase().includes(q.trim().toLowerCase()))
  return {
    configured: opts.configured ?? true,
    issuer: opts.issuer ?? 'fake-idp',
    async searchUsers(q, limit) {
      return (opts.users ?? []).filter((u) => has(q, u.sub, u.email, u.name)).slice(0, limit)
    },
    async searchGroups(q, limit) {
      return (opts.groups ?? []).filter((g) => has(q, g.group)).slice(0, limit)
    },
    async userStatus(sub) {
      const status = opts.statuses?.[sub] ?? 'error'
      const name = (opts.users ?? []).find((user) => user.sub === sub)?.name ?? ''
      return { status, name }
    },
    async getGroup(id) {
      const found = (opts.groups ?? []).find((group) => group.group === id)
      return found ? { id: found.group, name: found.name } : null
    },
    async getUserGroups(sub) {
      return (opts.userGroups?.[sub] ?? []).map((group) => ({ id: group, name: group }))
    },
  }
}
