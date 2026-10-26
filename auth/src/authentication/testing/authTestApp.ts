import { fakeClock, useClock, type FakeClock } from '../../clock.js'
import type { AuditFn } from '../../routeDeps.js'
import { createFakeIdp, type FakeIdp } from './fakeIdp.js'
import type { IdpAdapter, SignInOptions, TestUserSpec } from './idpAdapter.js'

export type AuthTestAppOptions<I extends IdpAdapter = FakeIdp> = {
  /** Users for the built-in fake IdP, or any other `IdpAdapter` (not yet started). */
  idp?: I | { users?: Record<string, TestUserSpec> }
  /** The BFF clock; defaults to a fake clock starting now. `Date` and the process clock follow it. */
  clock?: FakeClock
  /** `private-schema` (default) gives the process its own PostgreSQL schema; `shared` uses the configured one. */
  db?: 'private-schema' | 'shared'
  /** Audit sink for BFF-native mutations; defaults to a recorder exposed as `audit.events`. */
  audit?: AuditFn
}

export type AuditRecord = { sub: string; action: string }

/**
 * The authentication test harness: the real app over HTTP, wired to a test IdP, a controllable clock and a
 * test Postgres schema. Call `close()` to restore `Date`, the process clock and the environment.
 */
export async function createAuthTestApp(options?: AuthTestAppOptions<FakeIdp> & { idp?: { users?: Record<string, TestUserSpec> } }): ReturnType<typeof build<FakeIdp>>
export async function createAuthTestApp<I extends IdpAdapter>(options: AuthTestAppOptions<I> & { idp: I }): ReturnType<typeof build<I>>
export async function createAuthTestApp(options: AuthTestAppOptions<IdpAdapter> = {}) {
  return build(options)
}

async function build<I extends IdpAdapter>(options: AuthTestAppOptions<I>) {
  if (options.db !== 'shared') await import('../../db/testSchema.js')
  const { isolatedAuth } = await import('../../testSupport.js')
  const isolated = isolatedAuth()
  const { env, overrideEnv } = await import('../../env.js')
  const { createApp } = await import('../../app.js')

  const clock = options.clock ?? fakeClock(Date.now())
  const restoreClock = useClock(clock)
  // jose reads `new Date()`, not `Date.now`, so the constructor follows the clock as well.
  const RealDate = Date
  globalThis.Date = class extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(clock.now())
      else super(...(args as [number]))
    }
    static override now() {
      return clock.now()
    }
  } as DateConstructor

  const idp = (
    options.idp && 'signIn' in options.idp ? options.idp : await createFakeIdp({ clock, users: options.idp?.users })
  ) as I
  await idp.start()

  const restoreEnv = overrideEnv({
    oidcIssuer: idp.issuer,
    oidcIssuerPublic: idp.issuer,
    oidcClientId: idp.clientId,
    oidcRedirectUri: 'http://localhost/auth/callback',
  })

  const events: AuditRecord[] = []
  const app = createApp({
    audit: options.audit ?? (async (_c, user, _via, fields) => void events.push({ sub: user.sub, action: fields.action })),
  })

  /** Runs the whole browser login for IdP user `key`; `headers` carries the resulting session cookie. */
  async function login(key: string, opts: SignInOptions & { next?: string; callbackDelayMs?: number } = {}) {
    const { next, callbackDelayMs, ...signIn } = opts
    const start = await app.request(next ? `/auth/login?${new URLSearchParams({ next })}` : '/auth/login')
    const authorizeUrl = start.headers.get('location')
    if (start.status !== 302 || !authorizeUrl) throw new Error(`/auth/login answered ${start.status}`)
    const pkce = cookieHeader(start.headers.getSetCookie())
    const idpResult = await idp.signIn(key, authorizeUrl, signIn)
    if (callbackDelayMs) clock.advance(callbackDelayMs)
    const query = new URLSearchParams(
      idpResult.ok ? { code: idpResult.code, state: idpResult.state } : { error: idpResult.error, state: idpResult.state },
    )
    const callback = (over: { state?: string; cookie?: string } = {}) => {
      const q = new URLSearchParams(query)
      if (over.state !== undefined) q.set('state', over.state)
      return app.request(`/auth/callback?${q}`, { headers: { cookie: over.cookie ?? pkce } })
    }
    const response = await callback()
    const session = cookieHeader(response.headers.getSetCookie().filter((c) => c.startsWith(`${env.cookieName}=`)))
    return {
      status: response.status,
      response,
      /** Plays the same callback again, optionally with a tampered `state` or login cookie. */
      replay: callback,
      location: response.headers.get('location'),
      headers: session ? { cookie: session } : ({} as Record<string, string>),
    }
  }

  return {
    app,
    idp,
    clock,
    audit: { events },
    login,
    /** Moves the BFF clock (and the fake IdP, which follows it) forward. */
    advance: (ms: number) => clock.advance(ms),
    async close() {
      restoreEnv()
      await idp.stop()
      globalThis.Date = RealDate
      restoreClock()
      isolated.restore()
    },
  }
}

function cookieHeader(setCookies: string[]): string {
  return setCookies
    .map((c) => c.split(';')[0]!)
    .filter((c) => !c.endsWith('='))
    .join('; ')
}
