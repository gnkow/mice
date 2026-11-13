import { mkdirSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'

const BASE_ENV: Record<string, string> = {
  SESSION_SECRET: 'test-session-secret',
  OXEN_UPSTREAM: 'http://127.0.0.1:3001',
  AUTHZ_REQUIRE_TRAINING: 'false',
  AUTHZ_BOOTSTRAP_ADMINS: 'admin@mice.local',
}

export type TestPerson = {
  sub: string
  iss: string
  email: string
  name: string
  emailVerified?: boolean
  idToken?: string
}

/** Unsigned id_token carrying MFA claims; the Auditor role requires MFA evidence on the session. */
export const withMfa = <T extends TestPerson>(user: T): T => ({
  ...user,
  idToken: ['e30', Buffer.from(JSON.stringify({ acr: 'mfa', amr: ['pwd', 'otp'] })).toString('base64url'), 's'].join('.'),
})

/**
 * Isolated auth environment for tests: test env vars and a private workspace data directory in the project.
 * Call before importing modules that read `env`; `restore()` undoes both.
 */
export function isolatedAuth(extraEnv: Record<string, string> = {}) {
  const wanted = { ...BASE_ENV, ...extraEnv }
  const previousEnv: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(wanted)) {
    previousEnv[k] = process.env[k]
    process.env[k] = v
  }
  const dataDir = resolve(`.isolated-${randomUUID()}`)
  mkdirSync(dataDir, { recursive: true })
  previousEnv.AUTH_DATA_DIR = process.env.AUTH_DATA_DIR
  process.env.AUTH_DATA_DIR = dataDir
  const removeDataDir = () => rmSync(dataDir, { recursive: true, force: true })
  process.once('exit', removeDataDir)
  let restored = false

  const person = (sub: string): TestPerson => ({
    sub,
    iss: 'test',
    email: `${sub}@example.com`,
    name: sub,
  })
  const admin: TestPerson = {
    sub: 'admin',
    iss: 'test',
    email: wanted.AUTHZ_BOOTSTRAP_ADMINS.split(',')[0]!.trim(),
    name: 'Admin',
    emailVerified: true,
  }

  return {
    person,
    admin,
    async sessionHeaders(user: TestPerson): Promise<Record<string, string>> {
      return { cookie: await sealedSessionCookie(user), origin: 'http://localhost' }
    },
    /**
     * Assign a formal RBAC role in tests (bootstrap expiry). Needed after S23:
     * principals without a role are pending-gated and cannot use the API.
     */
    async grantRole(
      user: TestPerson,
      role: 'external' | 'user' | 'manager' | 'auditor' | 'admin' = 'user',
    ) {
      const { ensurePrincipal } = await import('./authentication/session/session.js')
      const { assignRole } = await import('./rbacStore.js')
      await ensurePrincipal(user)
      const result = await assignRole({
        actor: null,
        target: user,
        role,
        reason: 'test',
        bootstrap: true,
      })
      if (!result.ok) throw new Error(`grantRole failed: ${result.error}`)
    },
    restore() {
      if (restored) return
      restored = true
      removeDataDir()
      for (const [k, v] of Object.entries(previousEnv)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
    },
  }
}

/**
 * A configured directory that reports every user enabled and named, plus a sealed Session cookie.
 * Authentication checks the live directory and only accepts a sealed cookie, so a raw session id is not a session.
 */
export async function sealedSessionCookie(
  user: TestPerson & { sessionStart?: number; lastActive?: number; authTime?: number },
): Promise<string> {
  const { overrideEnv } = await import('./env.js')
  overrideEnv({
    directoryProvider: 'keycloak',
    keycloakAdminUrl: 'http://directory.test',
    keycloakRealm: 'mice',
    oidcClientId: 'mice-auth',
    oidcClientSecret: 'test-secret',
  })
  const { setDirectoryFetchForTests } = await import('./authentication/directory/directory.js')
  setDirectoryFetchForTests(async (input) => {
    const url = String(input)
    if (url.includes('/protocol/openid-connect/token')) {
      return new Response(JSON.stringify({ access_token: 'test-token', expires_in: 300 }), { status: 200 })
    }
    if (url.includes('/groups')) {
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (url.includes('/users/')) {
      return new Response(JSON.stringify({ enabled: true, firstName: 'Test', lastName: 'User' }), { status: 200 })
    }
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
  })
  const { ensureBootstrapKey } = await import('./authentication/session/sealKeys.js')
  const { sealSession } = await import('./authentication/session/session.js')
  const { sealSessionCookie } = await import('./authentication/session/cookieSeal.js')
  const { env } = await import('./env.js')
  await ensureBootstrapKey()
  const id = await sealSession({
    ...user,
    sessionStart: user.sessionStart ?? Math.floor(Date.now() / 1000) - 30,
  })
  return `${env.cookieName}=${await sealSessionCookie(id)}`
}

/**
 * Headers for a regulated mutation: reason + category + a freshly recorded signature
 * bound to this exact method/path/body (GxP ticket 27).
 */
export async function regulatedMutationHeaders(
  user: Pick<TestPerson, 'iss' | 'sub' | 'name'>,
  mutation: {
    method: string
    path: string
    body?: unknown
    reason?: string
    category?: string
    /** When false, omit content-type so multipart/binary requests keep their own. Default true. */
    jsonContentType?: boolean
  },
): Promise<Record<string, string>> {
  const reason = mutation.reason ?? 'Routine settings correction for assay batch'
  const category = mutation.category ?? 'privileged_settings'
  const { prepareMutationDocument } = await import('./mutationSignature.js')
  const { signatureStore } = await import('./authentication/signing/signatureStore.js')
  const prepared = prepareMutationDocument({
    method: mutation.method,
    path: mutation.path,
    reason,
    category,
    body: mutation.body ?? {},
  })
  const { id } = await (
    await signatureStore()
  ).record({
    signer: { iss: user.iss, sub: user.sub, name: user.name },
    meaning: 'Approved',
    contentHash: prepared.hash,
  })
  return {
    ...(mutation.jsonContentType === false ? {} : { 'content-type': 'application/json' }),
    'x-mice-reason': reason,
    'x-mice-reason-category': category,
    'x-mice-signature-id': id,
  }
}

/**
 * The stored notification events a user's Novu feed holds. Novu creates messages asynchronously, so when
 * `expect` is given this waits (by attempts, since tests may freeze `Date.now`) until that many exist.
 */
export async function novuInbox(user: { iss: string; sub: string }, expect = 0): Promise<Array<{ title: string; summary: string }>> {
  const { getNovu } = await import('./novu.js')
  const { subscriberId } = await import('./notifications.js')
  const { notificationUserKey } = await import('./notificationsStore.js')
  const id = subscriberId(notificationUserKey(user))
  for (let attempt = 0; ; attempt++) {
    const messages = await getNovu().feed(id)
    if (messages.length >= expect || attempt >= 200) {
      return messages.map((m) => m.payload as { title: string; summary: string })
    }
    await new Promise((r) => setTimeout(r, 100))
  }
}
