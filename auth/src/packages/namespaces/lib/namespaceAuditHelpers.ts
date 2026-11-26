import { pickSnapshot } from '../../audit/change.js'
import { principalRole, principalSeat } from '../../audit/index.js'
import { getNamespace } from '../../authz/index.js'
import { readRepository } from '../../authz/index.js'

const NS_SNAPSHOT_KEYS = ['id', 'name', 'description', 'basePermission', 'membersCanCreateRepos'] as const
const REPO_SNAPSHOT_KEYS = ['id', 'namespace', 'name', 'description'] as const

export function nsSnapshot(ns: Awaited<ReturnType<typeof getNamespace>>): Record<string, unknown> | null {
  return pickSnapshot(ns, NS_SNAPSHOT_KEYS)
}

export function repoSnapshot(repo: Awaited<ReturnType<typeof readRepository>>): Record<string, unknown> | null {
  return pickSnapshot(repo, REPO_SNAPSHOT_KEYS)
}

export function memberTarget(body: {
  kind?: 'user' | 'group'
  sub?: string
  iss?: string
  group?: string
  name?: string
}): Record<string, unknown> {
  const kind = body.kind ?? (body.group && !body.sub ? 'group' : 'user')
  const name = body.name?.trim()
  return kind === 'group'
    ? { kind, group: body.group, ...(name ? { name } : {}) }
    : { kind, sub: body.sub, iss: body.iss }
}

export { principalRole, principalSeat }
