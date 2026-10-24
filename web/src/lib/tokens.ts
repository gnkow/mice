export type PatPublic = {
  id: string
  label: string
  prefix: string
  createdAt: string
  lastUsedAt?: string
  expiresAt?: string
}

export type CreatePatResponse = {
  token: string
  pat: PatPublic
  cli: { remote: string; config: string }
}

export type CliInfo = {
  remote: string
  authHost: string
  loginExample?: string
  cloneExample: string
  configExample: string
  oxenCloneExample?: string
}

export async function fetchCliInfo(signal?: AbortSignal): Promise<CliInfo> {
  const res = await fetch('/auth/cli-info', {
    credentials: 'same-origin',
    signal,
  })
  if (!res.ok) throw new Error('Failed to load CLI info')
  return (await res.json()) as CliInfo
}

export async function listTokens(signal?: AbortSignal): Promise<PatPublic[]> {
  const res = await fetch('/auth/tokens', {
    credentials: 'same-origin',
    signal,
  })
  if (!res.ok) throw new Error('Failed to list tokens')
  const data = (await res.json()) as { tokens: PatPublic[] }
  return data.tokens
}

export async function createToken(
  label: string,
  expiresInDays: number,
  signal?: AbortSignal,
): Promise<CreatePatResponse> {
  const res = await fetch('/auth/tokens', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label, expiresInDays }),
    signal,
  })
  if (!res.ok) throw new Error('Failed to create token')
  return (await res.json()) as CreatePatResponse
}

export async function revokeToken(
  id: string,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`/auth/tokens/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
    signal,
  })
  if (!res.ok) throw new Error('Failed to revoke token')
}

/** Browser-visible oxen remote (BFF). Prefer Vite env, else /auth/cli-info. */
export function viteOxenRemote(): string | null {
  const v = import.meta.env.VITE_OXEN_REMOTE as string | undefined
  return v?.replace(/\/$/, '') || null
}
