import { createMemoryJsonBackend, useJsonBackend, type JsonBackend } from './jsonStore.js'

const BASE_ENV: Record<string, string> = {
  AUTH_DATA_DIR: '/mice-memory-data',
  SESSION_SECRET: 'test-session-secret',
  OXEN_UPSTREAM: 'http://127.0.0.1:3001',
  AUTHZ_ENFORCE: 'true',
  AUTHZ_DEV_GRANT_ALL: 'false',
  AUTHZ_REQUIRE_TRAINING: 'false',
  AUTHZ_BOOTSTRAP_ADMINS: 'admin@mice.local',
}

export type TestPerson = {
  sub: string
  iss: string
  email: string
  name: string
  emailVerified?: boolean
}

/**
 * Isolated auth environment for tests: memory persistence, test env vars.
 * Call before importing modules that read `env`; `restore()` undoes both.
 */
export function isolatedAuth(extraEnv: Record<string, string> = {}) {
  const wanted = { ...BASE_ENV, ...extraEnv }
  const previousEnv: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(wanted)) {
    previousEnv[k] = process.env[k]
    process.env[k] = v
  }
  const backend: JsonBackend = createMemoryJsonBackend()
  const restoreBackend = useJsonBackend(backend)
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
    backend,
    person,
    admin,
    async sessionHeaders(user: TestPerson): Promise<Record<string, string>> {
      const { sealSession } = await import('./session.js')
      const { env } = await import('./env.js')
      const token = await sealSession({ ...user, sessionStart: Math.floor(Date.now() / 1000) - 30 })
      return { cookie: `${env.cookieName}=${token}` }
    },
    restore() {
      if (restored) return
      restored = true
      restoreBackend()
      for (const [k, v] of Object.entries(previousEnv)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
    },
  }
}
