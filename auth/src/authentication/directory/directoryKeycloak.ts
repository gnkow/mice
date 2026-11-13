import { currentClock, type Clock } from '../../clock.js'
import { env } from '../../env.js'
import { composeIdpDisplayName } from '../oidc/idpDisplayName.js'
import { mapKeycloakDirectoryGroup, mapKeycloakGroupRow } from './directoryGroupOid.js'
import type {
  Directory,
  DirectoryGroupHit,
  DirectoryUserHit,
  DirectoryUserState,
} from './directoryTypes.js'

export type KeycloakDirectoryConfig = {
  /** Keycloak base URL for the Admin API (no /realms path); empty disables the adapter. */
  adminUrl: string
  realm: string
  clientId: string
  clientSecret: string
  /** Issuer stamped on user hits. */
  issuer: string
}

/** Keycloak Admin API adapter. Owns the HTTP calls and its own token cache. */
export function createKeycloakDirectory(
  configSource: KeycloakDirectoryConfig | (() => KeycloakDirectoryConfig),
  deps: { fetch?: typeof fetch; clock?: Clock } = {},
): Directory {
  const config = () => (typeof configSource === 'function' ? configSource() : configSource)
  const doFetch = deps.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
  const clock = deps.clock ?? currentClock
  let cache: { accessToken: string; expiresAt: number } | null = null

  const isConfigured = () => {
    const c = config()
    return Boolean(c.adminUrl && c.clientId && c.clientSecret)
  }
  const adminBase = () => {
    const c = config()
    return `${c.adminUrl}/admin/realms/${encodeURIComponent(c.realm)}`
  }

  async function token(): Promise<string | null> {
    if (!isConfigured()) return null
    const now = clock.now()
    if (cache && cache.expiresAt > now + 5_000) return cache.accessToken
    const c = config()
    const tokenUrl = `${c.adminUrl}/realms/${encodeURIComponent(c.realm)}/protocol/openid-connect/token`
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: c.clientId,
      client_secret: c.clientSecret,
    })
    try {
      const res = await doFetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      })
      if (!res.ok) {
        console.error('[mice-auth] Keycloak token failed', res.status, await res.text().catch(() => ''))
        return null
      }
      const json = (await res.json()) as { access_token?: string; expires_in?: number }
      if (!json.access_token) return null
      cache = { accessToken: json.access_token, expiresAt: now + (json.expires_in ?? 60) * 1000 }
      return json.access_token
    } catch (err) {
      console.error('[mice-auth] Keycloak token error', err)
      return null
    }
  }

  return {
    get configured() {
      return isConfigured()
    },
    get issuer() {
      return config().issuer
    },

    async searchUsers(q, limit) {
      const tok = await token()
      if (!tok) return []
      const url = new URL(`${adminBase()}/users`)
      url.searchParams.set('search', q.trim())
      url.searchParams.set('max', String(limit))
      url.searchParams.set('briefRepresentation', 'true')
      try {
        const res = await doFetch(url.toString(), { headers: { Authorization: `Bearer ${tok}` } })
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
        const iss = config().issuer
        return rows
          .filter((u) => u.id && u.enabled !== false)
          .map((u): DirectoryUserHit => ({
            kind: 'user',
            sub: u.id!,
            iss,
            email: u.email ?? '',
            name: [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.username || u.email || u.id!,
          }))
          .slice(0, limit)
      } catch (err) {
        console.error('[mice-auth] Keycloak user search error', err)
        return []
      }
    },

    async searchGroups(q, limit) {
      const tok = await token()
      if (!tok) return []
      const url = new URL(`${adminBase()}/groups`)
      url.searchParams.set('search', q.trim())
      url.searchParams.set('max', String(limit))
      try {
        const res = await doFetch(url.toString(), { headers: { Authorization: `Bearer ${tok}` } })
        if (!res.ok) {
          console.error('[mice-auth] Keycloak group search failed', res.status)
          return []
        }
        const rows = (await res.json()) as Array<{ id?: string; name?: string; path?: string }>
        const out: DirectoryGroupHit[] = []
        for (const g of rows) {
          const hit = mapKeycloakGroupRow(g)
          if (!hit) continue
          out.push(hit)
          if (out.length >= limit) break
        }
        return out
      } catch (err) {
        console.error('[mice-auth] Keycloak group search error', err)
        return []
      }
    },

    async userStatus(sub): Promise<DirectoryUserState> {
      const tok = await token()
      if (!tok) return { status: 'error', name: '' }
      try {
        const res = await doFetch(`${adminBase()}/users/${encodeURIComponent(sub)}`, {
          headers: { Authorization: `Bearer ${tok}` },
        })
        if (res.status === 404) return { status: 'missing', name: '' }
        if (!res.ok) return { status: 'error', name: '' }
        const user = (await res.json()) as { enabled?: boolean; firstName?: string; lastName?: string }
        const name = composeIdpDisplayName(user)
        return { status: user.enabled === false ? 'disabled' : 'enabled', name }
      } catch {
        return { status: 'error', name: '' }
      }
    },

    async getGroup(id): Promise<{ id: string; name: string } | null> {
      const tok = await token()
      if (!tok || !id.trim()) return null
      try {
        const res = await doFetch(`${adminBase()}/groups/${encodeURIComponent(id)}`, {
          headers: { Authorization: `Bearer ${tok}` },
        })
        if (!res.ok) return null
        const row = (await res.json()) as { id?: string; name?: string; path?: string }
        return mapKeycloakDirectoryGroup({ ...row, id: row.id || id })
      } catch (err) {
        console.error('[mice-auth] Keycloak group fetch error', err)
        return null
      }
    },

    async getUserGroups(sub): Promise<Array<{ id: string; name: string }>> {
      if (!isConfigured()) return []
      const tok = await token()
      if (!tok) throw new Error('directory group lookup failed')
      try {
        const res = await doFetch(`${adminBase()}/users/${encodeURIComponent(sub)}/groups`, {
          headers: { Authorization: `Bearer ${tok}` },
        })
        // Unknown to the directory (e.g. synthetic or locally-minted subjects) means no directory groups.
        if (res.status === 404) return []
        if (!res.ok) {
          throw new Error(`directory group lookup failed (${res.status})`)
        }
        const rows = (await res.json()) as Array<{ id?: string; name?: string; path?: string }>
        const groups: Array<{ id: string; name: string }> = []
        for (const g of rows) {
          const mapped = mapKeycloakDirectoryGroup(g)
          if (mapped) groups.push(mapped)
        }
        return groups
      } catch (err) {
        console.error('[mice-auth] Keycloak user groups fetch error', err)
        throw err instanceof Error ? err : new Error('directory group lookup failed')
      }
    },
  }
}

export function keycloakConfigFromEnv(): KeycloakDirectoryConfig {
  return {
    adminUrl: env.directoryProvider === 'keycloak' ? env.keycloakAdminUrl : '',
    realm: env.keycloakRealm,
    clientId: env.oidcClientId,
    clientSecret: env.oidcClientSecret,
    issuer: (env.oidcIssuerPublic || env.oidcIssuer || 'unknown').replace(/\/$/, ''),
  }
}
