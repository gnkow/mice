import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { expect } from '@playwright/test'
import { cleanTest as test } from '../fixtures'
import { uniqueId } from '../helpers/oxenApi'
import { mintSession } from '../helpers/session'

const AUTH_URL = process.env.AUTH_URL ?? 'http://localhost:8080'
const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..')

function compose(args: string[]): string {
  return execFileSync('docker', ['compose', ...args], { cwd: ROOT, encoding: 'utf8', timeout: 180_000 })
}

const dockerStack = (() => {
  try {
    return compose(['ps', '--status', 'running', '--services']).split('\n').includes('auth')
  } catch {
    return false
  }
})()

async function waitForReadyz(ok: boolean, ms = 150_000) {
  const deadline = Date.now() + ms
  let last = ''
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${AUTH_URL}/readyz`)
      last = `${res.status}`
      if ((res.status === 200) === ok) return
    } catch (err) {
      last = String(err)
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  throw new Error(`readyz ${ok ? 'green' : 'red'} not reached in ${ms}ms; last: ${last}`)
}

// Each database is stopped in turn: the BFF refuses, /readyz goes red, and service returns without a BFF restart.
for (const { service, probe } of [
  { service: 'postgres', probe: '/auth/me/authz' },
  { service: 'novu-api', probe: '/auth/notifications/unread-count' },
]) {
  test(`TC-OUTAGE: a stopped ${service} fails closed and recovers by itself`, async ({ page }) => {
    test.skip(!dockerStack, 'needs the compose stack and docker')
    test.setTimeout(400_000)
    await mintSession(page, { name: 'outage', email: `${uniqueId('outage')}@mice.local`, sub: uniqueId('outage'), iss: 'mice-e2e' })
    expect((await page.request.get(`${AUTH_URL}${probe}`)).status()).toBeLessThan(500)

    compose(['stop', service])
    try {
      await waitForReadyz(false)
      expect((await page.request.get(`${AUTH_URL}${probe}`)).status()).toBe(503)
    } finally {
      compose(['start', service])
    }
    await waitForReadyz(true)
    expect((await page.request.get(`${AUTH_URL}${probe}`)).status()).toBeLessThan(500)
  })
}
