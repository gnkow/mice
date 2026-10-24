import { parseAuthzMe, type AuthzMe } from './authzContract'

export type AuthUser = {
  sub: string
  iss: string
  email: string
  name: string
}

export type AuthMe =
  | { authenticated: true; user: AuthUser }
  | { authenticated: false }

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
  if (!res.ok) return { authenticated: false }
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

