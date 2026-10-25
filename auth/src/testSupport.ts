import { mkdirSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'

const BASE_ENV: Record<string, string> = {
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
      const { sealSession } = await import('./session.js')
      const { env } = await import('./env.js')
      const token = await sealSession({ ...user, sessionStart: Math.floor(Date.now() / 1000) - 30 })
      return { cookie: `${env.cookieName}=${token}` }
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
