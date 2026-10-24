import { env } from './env.js'
import {
  canReviewAccessRequests,
  listAccessRequests,
} from './accessRequests.js'
import { isPendingUser, preparePrincipal } from './authz.js'
import { listAllCollaboratorPrincipals } from './authzCollaboratorStore.js'
import { isInstanceAdmin, listInstanceAdmins, listInstancePermissionGrants } from './authzInstanceStore.js'
import { listNamespaceMembers, namespacesWithCapability } from './authzMembershipStore.js'
import { listNamespacesAuthz } from './authzNamespaceStore.js'
import { normalizeGroup } from './authzTypes.js'
import { principalKey } from './principal.js'
import { listPatOwners } from './tokens.js'
import type { SessionUser } from './session.js'

export type DirectoryUserHit = {
  kind: 'user'
  sub: string
  iss: string
  email: string
  name: string
}

export type DirectoryGroupHit = {
  kind: 'group'
  group: string
  name: string
}

export type DirectoryHit = DirectoryUserHit | DirectoryGroupHit

export type DirectorySearchResult = {
  results: DirectoryHit[]
  source: 'keycloak' | 'store' | 'mixed' | 'none'
  providerConfigured: boolean
}

export type DirectoryFetch = typeof fetch

type TokenCache = { accessToken: string; expiresAt: number }

let tokenCache: TokenCache | null = null

/** Test hook: inject fetch (e.g. mock Keycloak). */
let directoryFetch: DirectoryFetch = fetch

export function setDirectoryFetchForTests(fn: DirectoryFetch | null): void {
  directoryFetch = fn ?? fetch
  tokenCache = null
}

export function keycloakDirectoryConfigured(): boolean {
  return (
    env.directoryProvider === 'keycloak' &&
    Boolean(env.keycloakAdminUrl) &&
    Boolean(env.oidcClientId) &&
    Boolean(env.oidcClientSecret)
  )
}

export function canSearchDirectory(user: SessionUser): boolean {
  preparePrincipal(user)
  if (isPendingUser(user)) return false
  if (isInstanceAdmin(user)) return true
  if (canReviewAccessRequests(user)) return true
  if (namespacesWithCapability(user, 'manage_members').length > 0) return true
  return false
}

function issuerForHits(): string {
  return (env.oidcIssuerPublic || env.oidcIssuer || 'unknown').replace(
    /\/$/,
    '',
  )
}

function matchesQuery(q: string, ...fields: string[]): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return false
  return fields.some((f) => f.toLowerCase().includes(needle))
}

/** Principals already present in AuthZ / access-request stores. */
export function searchStoreDirectory(
  q: string,
  kind: 'user' | 'group',
  limit: number,
): DirectoryHit[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return []

  if (kind === 'group') {
    const groups = new Map<string, string>()
    for (const ns of Object.keys(listNamespacesAuthz())) {
      for (const m of listNamespaceMembers(ns)) {
        if (m.kind === 'group') {
          const g = normalizeGroup(m.group)
          if (g) groups.set(g, g)
        }
      }
    }
    for (const p of listAllCollaboratorPrincipals()) {
      if (p.kind === 'group') {
        const g = normalizeGroup(p.group)
        if (g) groups.set(g, g)
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

  const users = collectStorePrincipals()
  const out: DirectoryUserHit[] = []
  for (const u of users.values()) {
    if (matchesQuery(needle, u.sub, u.iss, u.email, u.name)) {
      out.push(u)
    }
    if (out.length >= limit) break
  }
  return out
}

/** Every user Principal known to the AuthZ / access-request / PAT stores. */
export function collectStorePrincipals(opts: { includePatOwners?: boolean } = {}): Map<string, DirectoryUserHit> {
  const users = new Map<string, DirectoryUserHit>()
  const issDefault = issuerForHits()

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

  for (const a of listInstanceAdmins()) addUser(a)
  for (const g of listInstancePermissionGrants()) {
    addUser({ sub: g.sub, iss: g.iss })
  }
  for (const r of listAccessRequests()) {
    addUser({
      sub: r.sub,
      iss: r.iss,
      email: r.email,
      name: r.name,
    })
  }
  for (const ns of Object.keys(listNamespacesAuthz())) {
    for (const m of listNamespaceMembers(ns)) {
      if (m.kind === 'user') {
        addUser({ sub: m.sub, iss: m.iss })
      }
    }
  }
  for (const p of listAllCollaboratorPrincipals()) {
    if (p.kind === 'user') addUser({ sub: p.sub, iss: p.iss })
  }
  if (opts.includePatOwners) for (const p of listPatOwners()) addUser(p)
  return users
}

async function getKeycloakToken(): Promise<string | null> {
  if (!keycloakDirectoryConfigured()) return null
  const now = Date.now()
  if (tokenCache && tokenCache.expiresAt > now + 5_000) {
    return tokenCache.accessToken
  }
  const tokenUrl = `${env.keycloakAdminUrl}/realms/${encodeURIComponent(env.keycloakRealm)}/protocol/openid-connect/token`
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: env.oidcClientId,
    client_secret: env.oidcClientSecret,
  })
  try {
    const res = await directoryFetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    if (!res.ok) {
      console.error(
        '[mice-auth] Keycloak token failed',
        res.status,
        await res.text().catch(() => ''),
      )
      return null
    }
    const json = (await res.json()) as {
      access_token?: string
      expires_in?: number
    }
    if (!json.access_token) return null
    tokenCache = {
      accessToken: json.access_token,
      expiresAt: now + (json.expires_in ?? 60) * 1000,
    }
    return json.access_token
  } catch (err) {
    console.error('[mice-auth] Keycloak token error', err)
    return null
  }
}

export type DirectoryUserStatus = 'enabled' | 'disabled' | 'missing' | 'error'

/** Looks a user up by Keycloak id; `error` means the directory could not answer. */
export async function lookupKeycloakUserStatus(sub: string): Promise<DirectoryUserStatus> {
  const token = await getKeycloakToken()
  if (!token) return 'error'
  const url = `${env.keycloakAdminUrl}/admin/realms/${encodeURIComponent(env.keycloakRealm)}/users/${encodeURIComponent(sub)}`
  try {
    const res = await directoryFetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (res.status === 404) return 'missing'
    if (!res.ok) return 'error'
    const user = (await res.json()) as { enabled?: boolean }
    return user.enabled === false ? 'disabled' : 'enabled'
  } catch {
    return 'error'
  }
}

export function directoryIssuer(): string {
  return issuerForHits()
}

async function searchKeycloakUsers(
  q: string,
  limit: number,
): Promise<DirectoryUserHit[]> {
  const token = await getKeycloakToken()
  if (!token) return []
  const url = new URL(
    `${env.keycloakAdminUrl}/admin/realms/${encodeURIComponent(env.keycloakRealm)}/users`,
  )
  url.searchParams.set('search', q.trim())
  url.searchParams.set('max', String(limit))
  url.searchParams.set('briefRepresentation', 'true')
  try {
    const res = await directoryFetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      console.error('[mice-auth] Keycloak user search failed', res.status)
      return []
    }
    const rows = (await res.json()) as Array<{
      id?: string
      username?: string
      email?: string
      firstName?: string
      lastName?: string
      enabled?: boolean
    }>
    const iss = issuerForHits()
    return rows
      .filter((u) => u.id && u.enabled !== false)
      .map((u) => {
        const name =
          [u.firstName, u.lastName].filter(Boolean).join(' ').trim() ||
          u.username ||
          u.email ||
          u.id!
        return {
          kind: 'user' as const,
          sub: u.id!,
          iss,
          email: u.email ?? '',
          name,
        }
      })
      .slice(0, limit)
  } catch (err) {
    console.error('[mice-auth] Keycloak user search error', err)
    return []
  }
}

async function searchKeycloakGroups(
  q: string,
  limit: number,
): Promise<DirectoryGroupHit[]> {
  const token = await getKeycloakToken()
  if (!token) return []
  const url = new URL(
    `${env.keycloakAdminUrl}/admin/realms/${encodeURIComponent(env.keycloakRealm)}/groups`,
  )
  url.searchParams.set('search', q.trim())
  url.searchParams.set('max', String(limit))
  try {
    const res = await directoryFetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      console.error('[mice-auth] Keycloak group search failed', res.status)
      return []
    }
    const rows = (await res.json()) as Array<{ name?: string; path?: string }>
    const out: DirectoryGroupHit[] = []
    for (const g of rows) {
      const raw = g.name || g.path || ''
      const leaf = raw.replace(/^\//, '').split('/').pop() ?? raw
      const name = normalizeGroup(leaf)
      if (!name) continue
      out.push({ kind: 'group', group: name, name })
      if (out.length >= limit) break
    }
    return out
  } catch (err) {
    console.error('[mice-auth] Keycloak group search error', err)
    return []
  }
}

function mergeHits(
  primary: DirectoryHit[],
  secondary: DirectoryHit[],
  limit: number,
): DirectoryHit[] {
  const seen = new Set<string>()
  const out: DirectoryHit[] = []
  for (const h of [...primary, ...secondary]) {
    const key =
      h.kind === 'user' ? `u:${principalKey(h)}` : `g:${normalizeGroup(h.group)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(h)
    if (out.length >= limit) break
  }
  return out
}

export async function searchDirectory(input: {
  q: string
  kind?: 'user' | 'group'
  limit?: number
}): Promise<DirectorySearchResult> {
  const q = (input.q ?? '').trim()
  const kind = input.kind === 'group' ? 'group' : 'user'
  const limit = Math.min(Math.max(1, input.limit ?? 25), 50)
  if (!q) {
    return {
      results: [],
      source: 'none',
      providerConfigured: keycloakDirectoryConfigured(),
    }
  }

  const storeHits = searchStoreDirectory(q, kind, limit)
  let kcHits: DirectoryHit[] = []
  const kcConfigured = keycloakDirectoryConfigured()
  if (kcConfigured) {
    kcHits =
      kind === 'group'
        ? await searchKeycloakGroups(q, limit)
        : await searchKeycloakUsers(q, limit)
  }

  if (kcConfigured && (kcHits.length > 0 || storeHits.length > 0)) {
    const results = mergeHits(kcHits, storeHits, limit)
    const source =
      kcHits.length > 0 && storeHits.length > 0
        ? 'mixed'
        : kcHits.length > 0
          ? 'keycloak'
          : 'store'
    return {
      results,
      source,
      providerConfigured: true,
    }
  }

  if (storeHits.length > 0) {
    return {
      results: storeHits.slice(0, limit),
      source: 'store',
      providerConfigured: kcConfigured,
    }
  }

  if (kcConfigured) {
    return {
      results: kcHits.slice(0, limit),
      source: kcHits.length ? 'keycloak' : 'none',
      providerConfigured: true,
    }
  }

  return {
    results: [],
    source: 'none',
    providerConfigured: false,
  }
}
