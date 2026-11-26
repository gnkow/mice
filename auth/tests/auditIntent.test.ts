import './db/testSchema.js'
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { isolatedAuth, regulatedMutationHeaders } from '../src/packages/shared/lib/testSupport.js'

const iso = isolatedAuth({ OXEN_UPSTREAM: 'http://oxen.invalid' })
const { createApp } = await import('../src/app.js')
const { setUpstreamFetch } = await import('../src/packages/proxy/lib/proxy.js')
const { preparePrincipal } = await import('../src/packages/authz/lib/authz.js')
const { setRepoCollaborator } = await import('../src/packages/authz/lib/authzCollaboratorStore.js')
const { createNamespaceAuthz } = await import('../src/packages/authz/lib/authzNamespaceStore.js')
const { appendAudit, useAuditLedger, verifyAudit } = await import('../src/packages/audit/lib/audit.js')
const { immudbConfig, openLedger } = await import('../src/packages/audit/lib/auditLedger.js')
const { ledgerEventsSince, ledgerHeadSeq } = await import('../src/packages/audit/lib/auditTestIsolation.js')

const real = await openLedger(immudbConfig())
let failAppends = false
let altered = new Set<number>()
let readAllCalls = 0
const ledger = {
  ...real,
  append: async (id: string, value: string) => {
    if (failAppends) throw new Error('immudb: no space left on device')
    return real.append(id, value)
  },
  readAll: () => {
    readAllCalls++
    return real.readAll()
  },
  verify: (opts?: Parameters<typeof real.verify>[0]) =>
    real.verify({ ...opts, tamper: (r) => (altered.has(r.seq) ? { ...r, value: r.value.replace('"action":"file.write"', '"action":"file.read"') } : r) }),
}
useAuditLedger(ledger)
const admin = iso.admin
await preparePrincipal(admin)
const writer = iso.person('intent-writer')
await createNamespaceAuthz(admin, 'in', 'none', true)
await setRepoCollaborator('in', 'r', writer, 'write')
await preparePrincipal(writer)
await iso.grantRole(writer, 'user')

type Row = Awaited<ReturnType<typeof ledgerEventsSince>>[number]
let since = 0
const ownActors = new Set([writer.sub, admin.sub])
/** Events this file's principals wrote since the current test began, oldest first. */
const rows = async () => ledgerEventsSince(real, since, { actors: ownActors })
const mutationRows = rows

let upstreamCalls: string[]
let restoreUpstream: () => void
let auditSnapshotAtUpstream: Row[] = []
const app = createApp()

beforeEach(async () => {
  since = await ledgerHeadSeq(real)
  failAppends = false
  altered = new Set()
  upstreamCalls = []
  auditSnapshotAtUpstream = []
  restoreUpstream = setUpstreamFetch(async (url, init) => {
    const method = init?.method ?? 'GET'
    const pathname = new URL(String(url)).pathname
    if (method === 'GET' && /\/branches\/[^/]+$/.test(pathname)) {
      return new Response(JSON.stringify({ branch: { commit_id: 'tip-before' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (method === 'GET' && pathname.includes('/meta/')) {
      return new Response(JSON.stringify({ status: 'error' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })
    }
    upstreamCalls.push(`${method} ${String(url)}`)
    if (method === 'PUT') auditSnapshotAtUpstream = await rows()
    return new Response(JSON.stringify({ status: 'ok', commit: { id: 'tip-after' } }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-mice-reason': 'Routine test change',
        'x-mice-change-control-id': 'CC-2026-114',
      },
    })
  })
})
afterEach(() => restoreUpstream())

async function put(user = writer) {
  // Non-default branch: direct tip-changing writes to validated `main` are refused.
  return app.request('/api/repos/in/r/file/feature/a.csv', {
    method: 'PUT',
    headers: { ...(await iso.sessionHeaders(user)), 'content-type': 'application/json', 'x-mice-reason': 'Routine test change', 'x-mice-change-control-id': 'CC-2026-114' },
    body: '{"message":"fix a"}',
  })
}

/** Makes every append to the audit ledger fail, as a full disk would. */
function breakAuditStore(): () => void {
  failAppends = true
  return () => {
    failAppends = false
  }
}

describe('intent-first proxied mutations', () => {
  it('writes an intent before the request reaches upstream and an outcome after, linked by id', async () => {
    const res = await put()
    assert.equal(res.status, 200)
    const mine = await mutationRows()
    assert.equal(mine.length, 2)
    const [intent, outcome] = mine
    assert.equal(intent!.phase, 'intent')
    assert.equal(intent!.action, 'file.write')
    assert.equal(outcome!.phase, 'outcome')
    assert.equal(outcome!.intent_id, intent!.id)
    assert.equal(outcome!.status, 200)
    assert.deepEqual(
      auditSnapshotAtUpstream.filter((r) => r.phase === 'intent' && ownActors.has(r.actor?.sub)).map((r) => r.id),
      [intent!.id],
    )
    assert.equal(
      auditSnapshotAtUpstream.some((r) => r.phase === 'outcome' && ownActors.has(r.actor?.sub)),
      false,
    )
    assert.equal((await verifyAudit()).ok, true)
  })

  it('records the upstream failure status in the outcome', async () => {
    restoreUpstream()
    restoreUpstream = setUpstreamFetch(async (url, init) => {
      const method = init?.method ?? 'GET'
      const pathname = new URL(String(url)).pathname
      // Before-state probes must succeed so fail-closed does not mask the upstream write status.
      if (method === 'GET' && /\/branches\/[^/]+$/.test(pathname)) {
        return new Response(JSON.stringify({ branch: { commit_id: 'tip-before' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (method === 'GET' && pathname.includes('/meta/')) {
        return new Response(JSON.stringify({ status: 'error' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response('{}', { status: 409 })
    })
    const res = await put()
    assert.equal(res.status, 409)
    assert.equal((await mutationRows()).find((r) => r.phase === 'outcome')!.status, 409)
  })

  it('refuses with 503 and reaches nothing upstream when the intent cannot be written', async () => {
    const { AUDIT_UNAVAILABLE_MESSAGE, auditUnavailablePayload } = await import('../src/packages/audit/lib/auditFailClosed.js')
    const headers = await iso.sessionHeaders(writer)
    const restore = breakAuditStore()
    try {
      const res = await app.request('/api/repos/in/r/file/feature/a.csv', {
        method: 'PUT',
        headers: { ...headers, 'content-type': 'application/json', 'x-mice-reason': 'Routine test change', 'x-mice-change-control-id': 'CC-2026-114' },
        body: '{"message":"fix a"}',
      })
      assert.equal(res.status, 503)
      assert.equal(res.headers.get('retry-after'), '30')
      assert.deepEqual(await res.json(), auditUnavailablePayload())
      assert.equal(auditUnavailablePayload().error.detail, AUDIT_UNAVAILABLE_MESSAGE)
      assert.equal(upstreamCalls.length, 0)
    } finally {
      restore()
    }
  })

  it('does not require an intent for reads', async () => {
    const restore = breakAuditStore()
    try {
      const res = await app.request('/api/repos/in/r/branches', { headers: await iso.sessionHeaders(writer) })
      assert.equal(res.status, 200)
      assert.equal(upstreamCalls.length, 1)
    } finally {
      restore()
    }
  })
})

describe('intent-first native mutations', () => {
  const addAdmin = async (user = admin) => {
    const path = '/auth/instance/permissions'
    const body = { sub: 'new-admin', iss: 'test', permissions: ['view_audit'], expiresAt: Date.now() + 86_400_000 }
    const regulated = await regulatedMutationHeaders(user, { method: 'PUT', path, body })
    return app.request(path, {
      method: 'PUT',
      headers: { ...(await iso.sessionHeaders(user)), ...regulated, 'x-mice-change-control-id': 'CC-2026-114' },
      body: JSON.stringify(body),
    })
  }

  it('writes intent then outcome around the change', async () => {
    const res = await addAdmin()
    assert.equal(res.status, 200)
    const mine = await mutationRows()
    assert.equal(mine.length, 2)
    const [intent, outcome] = mine
    assert.equal(intent!.phase, 'intent')
    assert.equal(outcome!.phase, 'outcome')
    assert.equal(outcome!.action, 'instance.permissions.update')
    assert.equal(outcome!.intent_id, intent!.id)
  })

  it('refuses with 503 and changes nothing when the intent cannot be written', async () => {
    const { auditUnavailableJson } = await import('../src/packages/audit/lib/auditFailClosed.js')
    const path = '/auth/instance/permissions'
    const body = { sub: 'blocked-admin', iss: 'test', permissions: ['view_audit'], expiresAt: Date.now() + 86_400_000 }
    const regulated = await regulatedMutationHeaders(admin, { method: 'PUT', path, body })
    const restore = breakAuditStore()
    try {
      const res = await app.request(path, {
        method: 'PUT',
        headers: { ...(await iso.sessionHeaders(admin)), ...regulated, 'x-mice-change-control-id': 'CC-2026-114' },
        body: JSON.stringify(body),
      })
      assert.equal(res.status, 503)
      assert.deepEqual(await res.json(), auditUnavailableJson())
    } finally {
      restore()
    }
    const instance = await app.request('/auth/instance', { headers: await iso.sessionHeaders(admin) })
    assert.equal(JSON.stringify(await instance.json()).includes('blocked-admin'), false)
  })
})

describe('listing intent and outcome', () => {
  it('lists one row per mutation, and shows intents and ids when asked', async () => {
    await put()
    const mine = new Set((await rows()).map((r) => r.id))
    const headers = await iso.sessionHeaders(admin)
    const list = (await (await app.request('/auth/audit?limit=100', { headers })).json()) as { events: Row[] }
    assert.deepEqual(
      list.events.filter((e) => mine.has(e.id) || (e.intent_id && mine.has(e.intent_id))).map((e) => e.phase),
      ['outcome'],
    )
    const all = (await (await app.request('/auth/audit?include=chain&limit=100', { headers })).json()) as { events: Row[] }
    assert.deepEqual(
      all.events.filter((e) => mine.has(e.id)).map((e) => e.phase).sort(),
      ['intent', 'outcome'],
    )
    const csv = await (await app.request('/auth/audit/export.csv', { headers })).text()
    const [head, ...body] = csv.trim().split('\r\n')
    assert.match(head!, /event_id,intent_id,phase/)
    assert.ok(body.some((l) => l.includes('file.write')))
  })

  it('keeps an intent that never got an outcome visible', async () => {
    const { appendIntent } = await import('../src/packages/audit/lib/audit.js')
    await appendIntent({
      actor: { sub: writer.sub, iss: 'test', email: 'e', name: 'n' },
      via: 'session',
      method: 'PUT',
      path: '/api/repos/in/r/file/main/z',
      status: 0,
      action: 'file.write',
      namespace: 'in',
    })
    const mine = new Set((await rows()).map((r) => r.id))
    const list = (await (await app.request('/auth/audit?limit=100', { headers: await iso.sessionHeaders(admin) })).json()) as {
      events: Row[]
    }
    assert.deepEqual(list.events.filter((e) => mine.has(e.id)).map((e) => e.phase), ['intent'])
  })
})

describe('readiness', () => {
  it('/readyz reports audit store and chain; /healthz stays static', async () => {
    await put()
    await verifyAudit()
    const ok = await app.request('/readyz')
    assert.equal(ok.status, 200)
    const body = (await ok.json()) as { ok: boolean; audit: { store: string; chain: string } }
    assert.equal(body.ok, true)
    assert.equal(body.audit.chain, 'ok')

    altered = new Set((await real.readAll()).filter((r) => r.value.includes('"action":"file.write"')).map((r) => r.seq))
    await verifyAudit()
    const broken = await app.request('/readyz')
    assert.equal(broken.status, 503)
    assert.equal(((await broken.json()) as { audit: { chain: string } }).audit.chain, 'broken')
    assert.equal((await app.request('/healthz')).status, 200)
  })

  it('/readyz fails after the audit store failed a write, until a write succeeds', async () => {
    const restore = breakAuditStore()
    try {
      assert.equal(await appendAudit({ actor: { sub: 's', iss: 'i', email: '', name: '' }, via: 'session', method: 'POST', path: '/x', status: 200, action: 'x' }), null)
      assert.equal((await app.request('/readyz')).status, 503)
    } finally {
      restore()
    }
    await appendAudit({ actor: { sub: 's', iss: 'i', email: '', name: '' }, via: 'session', method: 'POST', path: '/x', status: 200, action: 'x' })
    await verifyAudit()
    assert.equal((await app.request('/readyz')).status, 200)
  })

  it('/readyz fails while the workspace disk cannot be written, and reports it as storage', async () => {
    await put()
    await verifyAudit()
    const dataDir = process.env.AUTH_DATA_DIR
    process.env.AUTH_DATA_DIR = '/dev/null/data'
    try {
      const failed = await app.request('/readyz')
      assert.equal(failed.status, 503)
      const body = (await failed.json()) as { ok: boolean; storage: { ok: boolean; detail?: string } }
      assert.equal(body.storage.ok, false)
      assert.ok(body.storage.detail)
    } finally {
      process.env.AUTH_DATA_DIR = dataDir
    }
  })

  it('/readyz pings the ledger without reading the trail', async () => {
    await put()
    await verifyAudit()
    readAllCalls = 0
    assert.equal((await app.request('/readyz')).status, 200)
    assert.equal(readAllCalls, 0)
  })

  it('appending an audit event does not read the trail', async () => {
    for (let i = 0; i < 3; i++) await put()
    readAllCalls = 0
    await put()
    assert.equal(readAllCalls, 0)
  })
})
