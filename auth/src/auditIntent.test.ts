import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { isolatedAuth } from './testSupport.js'

const iso = isolatedAuth({ OXEN_UPSTREAM: 'http://oxen.invalid' })
const { createApp } = await import('./app.js')
const { setUpstreamFetch } = await import('./proxy.js')
const { preparePrincipal } = await import('./authz.js')
const { setRepoCollaborator } = await import('./authzCollaboratorStore.js')
const { createNamespaceAuthz } = await import('./authzNamespaceStore.js')
const { appendAudit, verifyAudit } = await import('./audit.js')
const { readText, useJsonBackend, writeText } = await import('./jsonStore.js')

const FILE = '/mice-memory-data/audit.jsonl'
const admin = iso.admin
preparePrincipal(admin)
const writer = iso.person('intent-writer')
createNamespaceAuthz(admin, 'in', 'none', true)
setRepoCollaborator('in', 'r', writer, 'write')
preparePrincipal(writer)

type Row = {
  id: string
  action: string
  phase?: string
  intent_id?: string
  status: number
  path: string
  actor: { sub: string }
}
const rows = () =>
  (readText(FILE) ?? '')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Row)
const mutationRows = () => rows().filter((r) => r.action !== 'audit.genesis')

let upstreamCalls: string[]
let restoreUpstream: () => void
let auditSnapshotAtUpstream: Row[] = []
const app = createApp()

beforeEach(() => {
  writeText(FILE, '')
  upstreamCalls = []
  auditSnapshotAtUpstream = []
  restoreUpstream = setUpstreamFetch(async (url, init) => {
    upstreamCalls.push(`${init?.method} ${String(url)}`)
    if (init?.method === 'PUT') auditSnapshotAtUpstream = rows()
    return new Response('{"status":"ok"}', { status: 200, headers: { 'content-type': 'application/json', 'x-mice-reason': 'Routine test change' } })
  })
})
afterEach(() => restoreUpstream())

async function put(user = writer) {
  return app.request('/api/repos/in/r/file/main/a.csv', {
    method: 'PUT',
    headers: { ...(await iso.sessionHeaders(user)), 'content-type': 'application/json', 'x-mice-reason': 'Routine test change' },
    body: '{"message":"fix a"}',
  })
}

/** Makes every append to the audit file fail, as a full disk would. */
function breakAuditStore(): () => void {
  return useJsonBackend({
    read: (p) => iso.backend.read(p),
    write: (p, t) => iso.backend.write(p, t),
    append: (p, t) => {
      if (p === FILE) throw new Error('ENOSPC: no space left on device')
      iso.backend.append!(p, t)
    },
  })
}

describe('intent-first proxied mutations', () => {
  it('writes an intent before the request reaches upstream and an outcome after, linked by id', async () => {
    const res = await put()
    assert.equal(res.status, 200)
    const [intent, outcome, ...rest] = mutationRows()
    assert.equal(rest.length, 0)
    assert.equal(intent!.phase, 'intent')
    assert.equal(intent!.action, 'file.write')
    assert.equal(outcome!.phase, 'outcome')
    assert.equal(outcome!.intent_id, intent!.id)
    assert.equal(outcome!.status, 200)
    assert.deepEqual(
      auditSnapshotAtUpstream.filter((r) => r.phase === 'intent').map((r) => r.id),
      [intent!.id],
    )
    assert.equal(auditSnapshotAtUpstream.some((r) => r.phase === 'outcome'), false)
    assert.equal(verifyAudit().ok, true)
  })

  it('records the upstream failure status in the outcome', async () => {
    restoreUpstream()
    restoreUpstream = setUpstreamFetch(async () => new Response('{}', { status: 409 }))
    const res = await put()
    assert.equal(res.status, 409)
    assert.equal(mutationRows().find((r) => r.phase === 'outcome')!.status, 409)
  })

  it('refuses with 503 and reaches nothing upstream when the intent cannot be written', async () => {
    const headers = await iso.sessionHeaders(writer)
    const restore = breakAuditStore()
    try {
      const res = await app.request('/api/repos/in/r/file/main/a.csv', {
        method: 'PUT',
        headers: { ...headers, 'content-type': 'application/json', 'x-mice-reason': 'Routine test change' },
        body: '{"message":"fix a"}',
      })
      assert.equal(res.status, 503)
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
  const addAdmin = async (user = admin) =>
    app.request('/auth/instance/admins', {
      method: 'POST',
      headers: { ...(await iso.sessionHeaders(user)), 'content-type': 'application/json', 'x-mice-reason': 'Routine test change' },
      body: JSON.stringify({ sub: 'new-admin', iss: 'test' }),
    })

  it('writes intent then outcome around the change', async () => {
    const res = await addAdmin()
    assert.equal(res.status, 200)
    const [intent, outcome, ...rest] = mutationRows()
    assert.equal(rest.length, 0)
    assert.equal(intent!.phase, 'intent')
    assert.equal(outcome!.phase, 'outcome')
    assert.equal(outcome!.action, 'instance.admin.add')
    assert.equal(outcome!.intent_id, intent!.id)
  })

  it('refuses with 503 and changes nothing when the intent cannot be written', async () => {
    const headers = await iso.sessionHeaders(admin)
    const restore = breakAuditStore()
    try {
      const res = await app.request('/auth/instance/admins', {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json', 'x-mice-reason': 'Routine test change' },
        body: JSON.stringify({ sub: 'blocked-admin', iss: 'test' }),
      })
      assert.equal(res.status, 503)
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
    const headers = await iso.sessionHeaders(admin)
    const list = (await (await app.request('/auth/audit', { headers })).json()) as { events: Row[] }
    assert.deepEqual(
      list.events.filter((e) => e.actor.sub === writer.sub).map((e) => e.phase),
      ['outcome'],
    )
    const all = (await (await app.request('/auth/audit?include=chain', { headers })).json()) as { events: Row[] }
    assert.deepEqual(
      all.events.filter((e) => e.actor.sub === writer.sub).map((e) => e.phase).sort(),
      ['intent', 'outcome'],
    )
    const csv = await (await app.request('/auth/audit/export.csv', { headers })).text()
    const [head, ...body] = csv.trim().split('\r\n')
    assert.match(head!, /event_id,intent_id,phase/)
    assert.equal(body.filter((l) => l.includes('file.write')).length, 1)
  })

  it('keeps an intent that never got an outcome visible', async () => {
    const { appendIntent } = await import('./audit.js')
    appendIntent({
      actor: { sub: writer.sub, iss: 'test', email: 'e', name: 'n' },
      via: 'session',
      method: 'PUT',
      path: '/api/repos/in/r/file/main/z',
      status: 0,
      action: 'file.write',
      namespace: 'in',
    })
    const list = (await (await app.request('/auth/audit', { headers: await iso.sessionHeaders(admin) })).json()) as {
      events: Row[]
    }
    assert.deepEqual(list.events.map((e) => e.phase), ['intent'])
  })
})

describe('readiness', () => {
  it('/readyz reports audit store and chain; /healthz stays static', async () => {
    await put()
    verifyAudit()
    const ok = await app.request('/readyz')
    assert.equal(ok.status, 200)
    const body = (await ok.json()) as { ok: boolean; audit: { store: string; chain: string } }
    assert.equal(body.ok, true)
    assert.equal(body.audit.chain, 'ok')

    writeText(FILE, readText(FILE)!.replace('"file.write"', '"file.read"'))
    verifyAudit()
    const broken = await app.request('/readyz')
    assert.equal(broken.status, 503)
    assert.equal(((await broken.json()) as { audit: { chain: string } }).audit.chain, 'broken')
    assert.equal((await app.request('/healthz')).status, 200)
  })

  it('/readyz fails after the audit store failed a write, until a write succeeds', async () => {
    const restore = breakAuditStore()
    try {
      assert.equal(appendAudit({ actor: { sub: 's', iss: 'i', email: '', name: '' }, via: 'session', method: 'POST', path: '/x', status: 200, action: 'x' }), null)
      assert.equal((await app.request('/readyz')).status, 503)
    } finally {
      restore()
    }
    appendAudit({ actor: { sub: 's', iss: 'i', email: '', name: '' }, via: 'session', method: 'POST', path: '/x', status: 200, action: 'x' })
    verifyAudit()
    assert.equal((await app.request('/readyz')).status, 200)
  })
})
