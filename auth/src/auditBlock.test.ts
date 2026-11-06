import './db/testSchema.js'
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { isolatedAuth, withMfa } from './testSupport.js'

const iso = isolatedAuth({ OXEN_UPSTREAM: 'http://oxen.invalid' })
const { createApp } = await import('./app.js')
const { setUpstreamFetch } = await import('./proxy.js')
const { preparePrincipal } = await import('./authz.js')
const { setRepoCollaborator } = await import('./authzCollaboratorStore.js')
const { createNamespaceAuthz } = await import('./authzNamespaceStore.js')
const { initAudit, queryAudit, useAuditLedger, verifyAudit } = await import('./audit.js')
const { immudbConfig, openLedger } = await import('./auditLedger.js')
const admin = iso.admin
await preparePrincipal(admin)
const writer = iso.person('block-writer')
const auditor = iso.person('block-auditor')
await createNamespaceAuthz(admin, 'bk', 'none', true)
await setRepoCollaborator('bk', 'r', writer, 'write')
await preparePrincipal(writer)
await iso.grantRole(writer, 'user')
await preparePrincipal(auditor)
await iso.grantRole(auditor, 'auditor')

const real = await openLedger(immudbConfig())
/** Seq numbers whose stored value is reported altered, as if someone rewrote them on the server. */
let altered = new Set<number>()
useAuditLedger({
  ...real,
  verify: (opts) =>
    real.verify({
      ...opts,
      tamper: (r) => (altered.has(r.seq) ? { ...r, value: r.value.replace('"status":', '"status":9') } : r),
    }),
})
const ownSeqs = async () => (await real.readAll()).map((r) => r.seq)

const app = createApp()
let upstreamCalls: string[]
let restoreUpstream: () => void

beforeEach(async () => {
  altered = new Set()
  await initAudit()
  upstreamCalls = []
  restoreUpstream = setUpstreamFetch(async (url, init) => {
    upstreamCalls.push(`${init?.method} ${String(url)}`)
    return new Response('{"status":"ok"}', { status: 200, headers: { 'content-type': 'application/json' } })
  })
})
afterEach(() => restoreUpstream())

const REASON = 'Routine test change'
async function put() {
  return app.request('/api/repos/bk/r/file/main/a.csv', {
    method: 'PUT',
    headers: { ...(await iso.sessionHeaders(writer)), 'content-type': 'application/json', 'x-mice-reason': REASON, 'x-mice-reason-category': 'privileged_settings', 'x-mice-change-control-id': 'CC-2026-114' },
    body: '{"message":"fix a"}',
  })
}
async function adminCall(method: string, path: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { ...(await iso.sessionHeaders(admin)), 'content-type': 'application/json', 'x-mice-reason': 'Operator decision after review', 'x-mice-reason-category': 'privileged_settings', 'x-mice-change-control-id': 'CC-2026-114' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
async function auditorCall(method: string, path: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { ...(await iso.sessionHeaders(withMfa(auditor))), 'content-type': 'application/json', 'x-mice-reason': 'Auditor review', 'x-mice-reason-category': 'privileged_settings', 'x-mice-change-control-id': 'CC-2026-114' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
const rows = async () => (await queryAudit({ includeChain: true, limit: 100 })).events
const tamperFirst = async () => {
  altered = new Set([(await ownSeqs())[0]!])
}

describe('failed verification blocks dataset mutations', () => {
  it('refuses with 503 audit_chain_broken and reaches nothing upstream', async () => {
    assert.equal((await put()).status, 200)
    await tamperFirst()
    assert.equal((await verifyAudit()).ok, false)
    upstreamCalls = []
    const res = await put()
    assert.equal(res.status, 503)
    assert.match(JSON.stringify(await res.json()), /audit_chain_broken/)
    assert.equal(upstreamCalls.length, 0)
    assert.equal((await app.request('/readyz')).status, 503)
  })

  it('lets only an admin acknowledge, records it as an event, and then unblocks', async () => {
    await tamperFirst()
    await verifyAudit()
    const forbidden = await app.request('/auth/audit/acknowledge', {
      method: 'POST',
      headers: { ...(await iso.sessionHeaders(writer)), 'content-type': 'application/json', 'x-mice-reason': 'I would like it fixed', 'x-mice-reason-category': 'privileged_settings', 'x-mice-change-control-id': 'CC-2026-114' },
      body: '{}',
    })
    assert.equal(forbidden.status, 403)
    assert.equal((await put()).status, 503)

    const ok = await adminCall('POST', '/auth/audit/acknowledge', {})
    assert.equal(ok.status, 200)
    const ack = (await rows()).find((r) => r.action === 'audit.break.acknowledge')!
    assert.equal(ack.actor.sub, 'admin')
    assert.equal(ack.reason, 'Operator decision after review')
    assert.match(String(ack.detail?.reason), /value/)
    assert.equal((await put()).status, 200)
    assert.equal((await app.request('/readyz')).status, 200)
  })

  it('has nothing to acknowledge on an intact chain', async () => {
    assert.equal((await adminCall('POST', '/auth/audit/acknowledge', {})).status, 409)
  })

  it('blocks again when a different break appears after an acknowledgement', async () => {
    assert.equal((await put()).status, 200)
    await tamperFirst()
    await verifyAudit()
    await adminCall('POST', '/auth/audit/acknowledge', {})
    assert.equal((await put()).status, 200, 'the acknowledged break does not block')
    altered = new Set([(await ownSeqs())[1]!])
    await verifyAudit()
    assert.equal((await put()).status, 503)
  })
})

describe('export bundle', () => {
  it('contains the events and a fresh verification result', async () => {
    assert.equal((await put()).status, 200)
    // Admin has no audit:read (S25); Auditor exports.
    const res = await auditorCall('GET', '/auth/audit/export.bundle?namespace=bk')
    assert.equal(res.status, 200)
    const bundle = (await res.json()) as Record<string, any>
    assert.equal(bundle.format, 'mice-audit-bundle/2')
    assert.ok(bundle.events.length >= 2)
    assert.ok(bundle.events.every((e: any) => e.namespace === 'bk'))
    assert.equal(bundle.verification.ok, true)
    assert.equal(bundle.signing, undefined)
  })

  it('logs who exported which range', async () => {
    await auditorCall('GET', '/auth/audit/export.bundle?namespace=bk&since=2020-01-01')
    const ev = (await rows()).find((r) => r.action === 'audit.export')!
    assert.equal(ev.actor.sub, 'block-auditor')
    assert.equal((ev.detail?.filters as any).namespace, 'bk')
    assert.equal((ev.detail?.filters as any).since, '2020-01-01')
    assert.equal(ev.detail?.format, 'bundle')
  })

  it('keeps the access rules of the audit read API', async () => {
    const res = await app.request('/auth/audit/export.bundle', { headers: await iso.sessionHeaders(writer) })
    assert.equal(res.status, 403)
  })
})
