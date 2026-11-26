import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export type NovuConfig = { url: string; email: string; password: string }

function passwordFrom(src: NodeJS.ProcessEnv): string {
  if (src.NOVU_PASSWORD) return src.NOVU_PASSWORD
  const found = [
    src.NOVU_PASSWORD_FILE,
    '/run/secrets/novu_password',
    resolve(process.cwd(), '.secrets/novu-password'),
    resolve(process.cwd(), '../.secrets/novu-password'),
  ]
    .filter((p): p is string => !!p)
    .find((p) => existsSync(p))
  if (!found) throw new Error('Novu password not found: set NOVU_PASSWORD or NOVU_PASSWORD_FILE, or run `make db-secrets`')
  return readFileSync(found, 'utf8').trim()
}

/** Connection settings for Novu; the same shape locally and in containers. */
export function novuConfig(src: NodeJS.ProcessEnv = process.env): NovuConfig {
  return {
    url: (src.NOVU_URL ?? 'http://127.0.0.1:3010').replace(/\/$/, ''),
    email: src.NOVU_EMAIL ?? 'mice-bff@mice.local',
    password: passwordFrom(src),
  }
}

export type NovuMessage = {
  id: string
  read: boolean
  seen: boolean
  createdAt: string
  payload: Record<string, unknown>
}

export type NovuHealth = { ok: true } | { ok: false; detail: string }

export type Novu = {
  /** Delivers one in-app message to a subscriber; replaying the same event id and payload creates no second message. */
  trigger(subscriberId: string, eventId: string, payload: Record<string, unknown>): Promise<void>
  /** The subscriber's messages, newest first; a subscriber Novu does not know has none. */
  feed(subscriberId: string): Promise<NovuMessage[]>
  mark(subscriberId: string, messageIds: string[], as: 'read' | 'unread' | 'seen'): Promise<void>
  deleteSubscriber(subscriberId: string): Promise<void>
  health(): Promise<NovuHealth>
}

export const WORKFLOW_ID = 'mice-event'
const PAGE = 100
const MAX_PAGES = 5
const TIMEOUT_MS = 15_000
const BOOTSTRAP_NAME = 'Mice BFF'

export class NovuError extends Error {
  override name = 'NovuError'
  constructor(message: string, readonly status?: number) {
    super(message)
  }
}

type Json = Record<string, any>

export function openNovu(config: NovuConfig): Novu {
  let ready: Promise<string> | undefined

  async function call(method: string, path: string, init: { headers?: Record<string, string>; body?: unknown } = {}): Promise<{ status: number; body: Json }> {
    let res: Response
    try {
      res = await fetch(`${config.url}${path}`, {
        method,
        headers: { 'content-type': 'application/json', ...init.headers },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (err) {
      throw new NovuError(`Novu unreachable: ${String((err as Error)?.message ?? err)}`)
    }
    const body = (await res.json().catch(() => ({}))) as Json
    return { status: res.status, body }
  }

  async function token(): Promise<string> {
    const credentials = { email: config.email, password: config.password }
    // Register first: failed logins count towards Novu's lockout, and an existing account simply answers 400.
    await call('POST', '/v1/auth/register', {
      body: { ...credentials, firstName: BOOTSTRAP_NAME, lastName: 'BFF', organizationName: 'Mice' },
    })
    const login = await call('POST', '/v1/auth/login', { body: credentials })
    if (login.status >= 300 || !login.body.data?.token) throw new NovuError('Novu login failed', login.status)
    return login.body.data.token
  }

  async function bootstrap(): Promise<string> {
    const jwt = await token()
    const envs = await call('GET', '/v1/environments', { headers: { authorization: `Bearer ${jwt}` } })
    const dev = (envs.body.data as Json[] | undefined)?.find((e) => e.type === 'dev') ?? (envs.body.data as Json[] | undefined)?.[0]
    const apiKey = dev?.apiKeys?.[0]?.key as string | undefined
    if (!apiKey) throw new NovuError('Novu has no API key for the environment', envs.status)
    const auth = { authorization: `ApiKey ${apiKey}` }
    const existing = await call('GET', `/v2/workflows/${WORKFLOW_ID}`, { headers: auth })
    if (existing.status === 404) {
      const created = await call('POST', '/v2/workflows', {
        headers: auth,
        body: {
          name: WORKFLOW_ID,
          workflowId: WORKFLOW_ID,
          description: 'Mice activity shown in the inbox',
          steps: [
            {
              name: 'In-app',
              type: 'in_app',
              controlValues: { subject: '{{payload.title}}', body: '{{payload.summary}}' },
            },
          ],
        },
      })
      if (created.status >= 300) throw new NovuError('Novu workflow could not be created', created.status)
    } else if (existing.status >= 300) throw new NovuError('Novu workflow lookup failed', existing.status)
    return apiKey
  }

  async function authorization(): Promise<Record<string, string>> {
    ready ??= bootstrap().catch((err: unknown) => {
      ready = undefined
      throw err
    })
    return { authorization: `ApiKey ${await ready}` }
  }

  async function authed(method: string, path: string, init: { headers?: Record<string, string>; body?: unknown } = {}) {
    const res = await call(method, path, { ...init, headers: { ...(await authorization()), ...init.headers } })
    if (res.status === 401) ready = undefined
    return res
  }

  const fail = (what: string, res: { status: number; body: Json }): never => {
    throw new NovuError(`Novu ${what} failed (${res.status})`, res.status)
  }

  return {
    async trigger(subscriberId, eventId, payload) {
      const res = await authed('POST', '/v1/events/trigger', {
        headers: { 'idempotency-key': `${eventId}:${subscriberId}` },
        body: { name: WORKFLOW_ID, to: { subscriberId }, payload, transactionId: `${eventId}:${subscriberId}` },
      })
      if (res.status >= 300) fail('trigger', res)
    },
    async feed(subscriberId) {
      const out: NovuMessage[] = []
      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await authed('GET', `/v1/subscribers/${encodeURIComponent(subscriberId)}/notifications/feed?page=${page}&limit=${PAGE}`)
        if (res.status === 400 && /not found/i.test(String(res.body.message))) return out
        if (res.status >= 300) fail('feed', res)
        for (const m of res.body.data as Json[]) {
          out.push({ id: m._id, read: !!m.read, seen: !!m.seen, createdAt: m.createdAt, payload: m.payload ?? {} })
        }
        if (!res.body.hasMore) break
      }
      return out
    },
    async mark(subscriberId, messageIds, as) {
      if (!messageIds.length) return
      const res = await authed('POST', `/v1/subscribers/${encodeURIComponent(subscriberId)}/messages/mark-as`, {
        body: { messageId: messageIds, markAs: as },
      })
      if (res.status >= 300) fail('mark', res)
    },
    async deleteSubscriber(subscriberId) {
      const res = await authed('DELETE', `/v1/subscribers/${encodeURIComponent(subscriberId)}`)
      if (res.status >= 300 && res.status !== 400 && res.status !== 404) fail('delete subscriber', res)
    },
    async health() {
      try {
        const res = await call('GET', '/v1/health-check')
        return res.status < 300 ? { ok: true } : { ok: false, detail: `Novu health check failed (${res.status})` }
      } catch (err) {
        return { ok: false, detail: String((err as Error)?.message ?? err) }
      }
    },
  }
}

let shared: Novu | undefined
let touched = new Set<string>()

/** The process-wide client. */
export function getNovu(): Novu {
  shared ??= openNovu(novuConfig())
  return shared
}

/** Swaps the client (tests wrap the real one to inject faults). */
export function useNovu(next: Novu): void {
  shared = next
}

/** Records a subscriber this process wrote to, so tests can remove them afterwards. */
export function noteSubscriber(id: string): void {
  touched.add(id)
}

/** Deletes every subscriber this process created in Novu, and their messages. */
export async function purgeTouchedSubscribers(): Promise<void> {
  const ids = [...touched]
  touched = new Set()
  await Promise.all(ids.map((id) => getNovu().deleteSubscriber(id).catch(() => undefined)))
}
