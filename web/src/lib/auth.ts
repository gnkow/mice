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

export type AuthzMe = {
  enforce: boolean
  pending: boolean
  instanceAdmin: boolean
  permissions: {
    create_namespace: boolean
    view_audit: boolean
    manage_breakglass: boolean
  }
  hasAnyGrant: boolean
  trainingCompleted?: boolean
  requireTraining?: boolean
}

export async function fetchAuthzMe(signal?: AbortSignal): Promise<AuthzMe | null> {
  const res = await fetch('/auth/me/authz', {
    credentials: 'same-origin',
    signal,
  })
  if (!res.ok) return null
  return (await res.json()) as AuthzMe
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

/** Dev-only: establish a session without Keycloak when AUTH_DEV_MODE is on. */
export async function devLogin(body?: Partial<AuthUser>): Promise<boolean> {
  const res = await fetch('/auth/dev-login', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  return res.ok
}
