import assert from 'node:assert/strict'
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { isolatedAuth } from './testSupport.js'

const iso = isolatedAuth({ OXEN_UPSTREAM: 'http://oxen.invalid' })
const { createApp } = await import('./app.js')
const { setUpstreamFetch } = await import('./proxy.js')
const { preparePrincipal } = await import('./authz.js')
const { setRepoCollaborator } = await import('./authzCollaboratorStore.js')
const { createNamespaceAuthz } = await import('./authzNamespaceStore.js')
const { appendAudit, initAudit, useAuditSigningKey, verifyAudit, writeCheckpoint } = await import('./audit.js')
const { canonicalJson } = await import('./auditChain.js')
const { readText, writeText } = await import('./jsonStore.js')

const FILE = '/mice-memory-data/audit.jsonl'
const admin = iso.admin
preparePrincipal(admin)
const writer = iso.person('block-writer')
createNamespaceAuthz(admin, 'bk', 'none', true)
setRepoCollaborator('bk', 'r', writer, 'write')
preparePrincipal(writer)

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const KEY = { keyId: 'bundle-key', privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() }
const PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString()

const app = createApp()
let upstreamCalls: string[]
let restoreUpstream: () => void

beforeEach(() => {
  writeText(FILE, '')
  writeText('/mice-memory-data/audit-checkpoints.jsonl', '')
  initAudit()
  useAuditSigningKey(KEY)
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
    headers: { ...(await iso.sessionHeaders(writer)), 'content-type': 'application/json', 'x-mice-reason': REASON },
    body: '{"message":"fix a"}',
  })
}
async function adminCall(method: string, path: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { ...(await iso.sessionHeaders(admin)), 'content-type': 'application/json', 'x-mice-reason': 'Operator decision after review' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
const rows = () => (readText(FILE) ?? '').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { action: string; actor: { sub: string }; reason?: string; detail?: Record<string, unknown> })

/** Edits an old event in place, as someone with write access to the volume would. */
function tamper() {
  const lines = (readText(FILE) ?? '').split('\n').filter(Boolean)
  lines[0] = lines[0]!.replace('"status":200', '"status":201')
  writeText(FILE, `${lines.join('\n')}\n`)
}

describe('failed verification blocks dataset mutations', () => {
  it('refuses with 503 audit_chain_broken and reaches nothing upstream', async () => {
    assert.equal((await put()).status, 200)
    tamper()
    assert.equal(verifyAudit().ok, false)
    upstreamCalls = []
    const res = await put()
    assert.equal(res.status, 503)
    assert.match(JSON.stringify(await res.json()), /audit_chain_broken/)
    assert.equal(upstreamCalls.length, 0)
    assert.equal((await app.request('/readyz')).status, 503)
  })

  it('lets only an admin acknowledge, records it as an event, and then unblocks', async () => {
    tamper()
    verifyAudit()
    const forbidden = await app.request('/auth/audit/acknowledge', {
      method: 'POST',
      headers: { ...(await iso.sessionHeaders(writer)), 'content-type': 'application/json', 'x-mice-reason': 'I would like it fixed' },
      body: '{}',
    })
    assert.equal(forbidden.status, 403)
    assert.equal((await put()).status, 503)

    const ok = await adminCall('POST', '/auth/audit/acknowledge', {})
    assert.equal(ok.status, 200)
    const ack = rows().find((r) => r.action === 'audit.break.acknowledge')!
    assert.equal(ack.actor.sub, 'admin')
    assert.equal(ack.reason, 'Operator decision after review')
    assert.match(String(ack.detail?.reason), /altered/)
    assert.equal((await put()).status, 200)
    assert.equal((await app.request('/readyz')).status, 200)
  })

  it('has nothing to acknowledge on an intact chain', async () => {
    assert.equal((await adminCall('POST', '/auth/audit/acknowledge', {})).status, 409)
  })

  it('blocks again when a different break appears after an acknowledgement', async () => {
    assert.equal((await put()).status, 200)
    const original = readText(FILE)!
    tamper()
    verifyAudit()
    await adminCall('POST', '/auth/audit/acknowledge', {})
    assert.equal((await put()).status, 200, 'the acknowledged break does not block')
    const lines = (readText(FILE) ?? '').split('\n').filter(Boolean)
    lines[0] = original.split('\n')[0]!
    lines[1] = lines[1]!.replace('"status":0', '"status":7')
    writeText(FILE, `${lines.join('\n')}\n`)
    verifyAudit()
    assert.equal((await put()).status, 503)
  })
})

describe('signed export bundle', () => {
  it('contains events, checkpoints, the verification result and the key, signed with the checkpoint key', async () => {
    assert.equal((await put()).status, 200)
    writeCheckpoint('manual')
    const res = await adminCall('GET', '/auth/audit/export.bundle?namespace=bk')
    assert.equal(res.status, 200)
    const bundle = (await res.json()) as Record<string, any>
    assert.ok(bundle.events.length >= 2)
    assert.ok(bundle.events.every((e: any) => e.namespace === 'bk' && typeof e.hash === 'string'))
    assert.equal(bundle.checkpoints.length, 1)
    assert.equal(bundle.verification.ok, true)
    assert.equal(bundle.signing.key_id, 'bundle-key')
    assert.equal(bundle.public_keys.find((k: any) => k.key_id === 'bundle-key').public_key_pem.trim(), PUBLIC_PEM.trim())
    const { signing, ...body } = bundle
    assert.ok(verify(null, Buffer.from(canonicalJson(body)), createPublicKey(PUBLIC_PEM), Buffer.from(signing.signature, 'base64')))
    body.events[0].status = 999
    assert.equal(
      verify(null, Buffer.from(canonicalJson(body)), createPublicKey(PUBLIC_PEM), Buffer.from(signing.signature, 'base64')),
      false,
    )
  })

  it('logs who exported which range', async () => {
    await adminCall('GET', '/auth/audit/export.bundle?namespace=bk&since=2020-01-01')
    const ev = rows().find((r) => r.action === 'audit.export')!
    assert.equal(ev.actor.sub, 'admin')
    assert.equal((ev.detail?.filters as any).namespace, 'bk')
    assert.equal((ev.detail?.filters as any).since, '2020-01-01')
    assert.equal(ev.detail?.format, 'bundle')
  })

  it('keeps the access rules of the audit read API', async () => {
    const res = await app.request('/auth/audit/export.bundle', { headers: await iso.sessionHeaders(writer) })
    assert.equal(res.status, 403)
  })
})
