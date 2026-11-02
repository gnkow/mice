export type PatScope = {
  namespace: string
  repo?: string
  maxRole: 'read' | 'triage' | 'write' | 'maintain' | 'admin'
}

export function formatScope(s: PatScope): string {
  return `${s.namespace}${s.repo ? `/${s.repo}` : ''}: ${s.maxRole}`
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

/** Browser-visible oxen remote (BFF). Prefer Vite env, else /auth/cli-info. */
export function viteOxenRemote(): string | null {
  const v = import.meta.env.VITE_OXEN_REMOTE as string | undefined
  return v?.replace(/\/$/, '') || null
}
