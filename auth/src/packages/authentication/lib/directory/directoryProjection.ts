import { listAllCollaboratorPrincipals } from '../../../authz/stores.js'
import { listInstanceAdmins, listInstancePermissionGrants } from '../../../authz/stores.js'
import { listNamespaceMembers } from '../../../authz/stores.js'
import { listNamespacesAuthz } from '../../../authz/stores.js'
import { normalizeGroup } from '../../../authz/types.js'
import type { DirectoryGroupHit, DirectoryHit, DirectoryUserHit } from './directoryTypes.js'
import { principalKey } from '../session/principal.js'

/** Lazy: accessRequests → authz → privilegedGroups must not close a cycle through directory. */
async function listAccessRequests() {
  const m = await import('../../../authz/index.js')
  return m.listAccessRequests()
}

/** Lazy: cliCredentials → directoryRuntime; keep projection out of that graph. */
async function listCliCredentialHolders() {
  const m = await import('../credentials/cliCredentials.js')
  return m.listCliCredentialHolders()
}

function matchesQuery(q: string, ...fields: string[]): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return false
  return fields.some((f) => f.toLowerCase().includes(needle))
}

/** Local projection: principals already present in AuthZ / access-request stores. */
export async function searchStoreDirectory(
  q: string,
  kind: 'user' | 'group',
  limit: number,
  defaultIssuer: string,
): Promise<DirectoryHit[]> {
  const needle = q.trim().toLowerCase()
  if (!needle) return []

  if (kind === 'group') {
    const groups = new Map<string, string>()
    for (const ns of Object.keys(await listNamespacesAuthz())) {
      for (const m of await listNamespaceMembers(ns)) {
        if (m.kind === 'group') {
          const g = normalizeGroup(m.group)
          if (g) groups.set(g, m.name?.trim() || g)
        }
      }
    }
    for (const p of await listAllCollaboratorPrincipals()) {
      if (p.kind === 'group') {
        const g = normalizeGroup(p.group)
        if (g) groups.set(g, p.name?.trim() || g)
      }
    }
    const out: DirectoryGroupHit[] = []
    for (const [g, name] of groups) {
      if (matchesQuery(needle, g, name)) {
        out.push({ kind: 'group', group: g, name })
      }
      if (out.length >= limit) break
    }
    return out
  }

  const users = await collectStorePrincipals({ defaultIssuer })
  const out: DirectoryUserHit[] = []
  for (const u of users.values()) {
    if (matchesQuery(needle, u.sub, u.iss, u.email, u.name)) {
      out.push(u)
    }
    if (out.length >= limit) break
  }
  return out
}

/** Every user Principal known to the AuthZ / access-request / CLI credential stores. */
export async function collectStorePrincipals(opts: { defaultIssuer: string }): Promise<Map<string, DirectoryUserHit>> {
  const users = new Map<string, DirectoryUserHit>()
  const issDefault = opts.defaultIssuer

  function addUser(u: {
    sub: string
    iss: string
    email?: string
    name?: string
  }) {
    const key = principalKey(u)
    if (users.has(key)) return
    users.set(key, {
      kind: 'user',
      sub: u.sub,
      iss: u.iss || issDefault,
      email: u.email ?? '',
      name: u.name || u.email || u.sub,
    })
  }

  for (const a of await listInstanceAdmins()) addUser(a)
  for (const g of await listInstancePermissionGrants()) {
    addUser({ sub: g.sub, iss: g.iss })
  }
  for (const r of await listAccessRequests()) {
    addUser({
      sub: r.sub,
      iss: r.iss,
      email: r.email,
      name: r.name,
    })
  }
  for (const ns of Object.keys(await listNamespacesAuthz())) {
    for (const m of await listNamespaceMembers(ns)) {
      if (m.kind === 'user') {
        addUser({ sub: m.sub, iss: m.iss })
      }
    }
  }
  for (const p of await listAllCollaboratorPrincipals()) {
    if (p.kind === 'user') addUser({ sub: p.sub, iss: p.iss })
  }
  for (const p of await listCliCredentialHolders()) addUser(p)
  return users
}

