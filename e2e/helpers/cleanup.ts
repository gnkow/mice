import { request, type APIRequestContext, type BrowserContext } from '@playwright/test'
import { mintSessionCookie } from './session'

const BASE_URL = process.env.MICE_BASE_URL ?? 'http://localhost:5173'
const REASON = 'e2e: automated cleanup'

export type Snapshot = {
  namespaces: Set<string>
  tokens: Set<string>
}

/** An API context for the default suite identity (admins cannot see or delete member namespaces). */
export async function cleanupContext(): Promise<APIRequestContext> {
  const minted = await mintSessionCookie()
  return request.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: {
      cookie: `${minted.cookieName}=${minted.cookieValue}`,
      origin: BASE_URL,
      'x-mice-reason': REASON,
    },
  })
}

async function json(ctx: APIRequestContext, path: string): Promise<Record<string, unknown>> {
  const res = await ctx.get(path)
  return res.ok() ? ((await res.json()) as Record<string, unknown>) : {}
}

export async function snapshot(ctx: APIRequestContext): Promise<Snapshot> {
  const ns = (await json(ctx, '/auth/namespaces')).namespaces as { name: string }[] | undefined
  const tokens = (await json(ctx, '/auth/me/tokens')).tokens as { id: string }[] | undefined
  return {
    namespaces: new Set((ns ?? []).map((n) => n.name)),
    tokens: new Set((tokens ?? []).map((t) => t.id)),
  }
}

/** Session cookies a test installed on a browser context, whatever it clears later. */
export function trackSessionCookies(context: BrowserContext): () => Array<{ name: string; value: string }> {
  const seen: Array<{ name: string; value: string }> = []
  const addCookies = context.addCookies.bind(context)
  context.addCookies = async (cookies) => {
    for (const c of cookies) {
      if (c.name.includes('mice_session')) seen.push({ name: c.name, value: c.value })
    }
    return addCookies(cookies)
  }
  return () => [...seen]
}

/** Revoke tokens created since `since` by each identity that logged in during the test. */
export async function revokeTokensSince(
  cookies: Array<{ name: string; value: string }>,
  since: number,
): Promise<void> {
  for (const { name, value } of cookies) {
    const ctx = await request.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: {
        cookie: `${name}=${value}`,
        origin: BASE_URL,
        'x-mice-reason': REASON,
      },
    })
    try {
      const tokens = (await json(ctx, '/auth/me/tokens')).tokens as { id: string; createdAt: string }[] | undefined
      for (const t of tokens ?? []) {
        if (Date.parse(t.createdAt) < since) continue
        await ctx.delete(`/auth/me/tokens/${encodeURIComponent(t.id)}`).catch(() => undefined)
      }
    } finally {
      await ctx.dispose()
    }
  }
}

/** Remove what a test added since `before`; best effort, never fails a test. */
export async function cleanupSince(ctx: APIRequestContext, before: Snapshot): Promise<void> {
  const after = await snapshot(ctx)
  for (const id of after.tokens) {
    if (before.tokens.has(id)) continue
    await ctx.delete(`/auth/me/tokens/${encodeURIComponent(id)}`).catch(() => undefined)
  }
  for (const name of after.namespaces) {
    if (before.namespaces.has(name)) continue
    await ctx.delete(`/auth/namespaces/${encodeURIComponent(name)}`).catch(() => undefined)
  }
}
