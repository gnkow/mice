import { parseAuthzMe, type AuthzMe } from './authzContract'
import { decideIdpAccessGate, type IdpAccessGate } from './idpAccessGate'

export type AuthUserGroup = {
  bindingKey: string
  displayName: string
}

export type AuthUser = {
  sub: string
  iss: string
  email: string
  name: string
  /**
   * Current IdP session evidences MFA (acr + qualifying amr).
   * False when password-only or claims missing — not the same as IdP enrollment.
   */
  mfaEvidenced?: boolean
  /** IdP groups on this session (from login / overage resolve). */
  groups?: AuthUserGroup[]
}

export type AuthMe =
  | { authenticated: true; user: AuthUser }
  | { authenticated: false; gate?: IdpAccessGate }

export type LogoutResult = {
  ok: boolean
  /** When set, browser must navigate here to clear the IdP SSO session. */
  idpLogoutUrl: string | null
}

export async function fetchAuthMe(signal?: AbortSignal): Promise<AuthMe> {
  const res = await fetch('/auth/me', {
    credentials: 'same-origin',
    signal,
  })
  if (res.status === 401) return { authenticated: false }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    const gate = decideIdpAccessGate(res.status, body?.error)
    return gate ? { authenticated: false, gate } : { authenticated: false }
  }
  return (await res.json()) as AuthMe
}

export type { AuthzMe, InstancePermission as AuthzInstancePermission } from './authzContract'

export async function fetchAuthzMe(signal?: AbortSignal): Promise<AuthzMe | null> {
  const res = await fetch('/auth/me/authz', {
    credentials: 'same-origin',
    signal,
  })
  if (!res.ok) return null
  return parseAuthzMe(await res.json())
}

/** Refresh IdP groups on this session from the directory (Profile → Group membership). */
export async function refreshAuthMeGroups(): Promise<AuthUserGroup[]> {
  const res = await fetch('/auth/me/groups/refresh', {
    method: 'POST',
    credentials: 'same-origin',
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? 'Could not refresh group membership')
  }
  const data = (await res.json()) as { groups?: AuthUserGroup[] }
  return data.groups ?? []
}

/** True when the caller's effective RBAC permissions include `permission`. */
export function hasEffectivePermission(me: AuthzMe, permission: string): boolean {
  return me.effectivePermissions.includes(permission)
}

/** System-management Admin role (not data access). */
export function isAdminRole(me: AuthzMe): boolean {
  return me.role === 'admin'
}

export async function logout(): Promise<LogoutResult> {
  const res = await fetch('/auth/logout', {
    method: 'POST',
    credentials: 'same-origin',
  })
  if (!res.ok) return { ok: false, idpLogoutUrl: null }
  const data = (await res.json()) as { ok?: boolean; idpLogoutUrl?: string | null }
  return {
    ok: Boolean(data.ok),
    idpLogoutUrl: data.idpLogoutUrl ?? null,
  }
}

