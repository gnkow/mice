import './db/testSchema.js'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, beforeEach, describe, it } from 'node:test'

const dataDir = mkdtempSync(join(tmpdir(), 'mice-proxy-author-'))

type Received = { method: string; url: string; contentType: string; body: string }
let received: Received[] = []
const upstream: Server = createServer((req, res) => {
  const chunks: Buffer[] = []
  req.on('data', (c: Buffer) => chunks.push(c))
  req.on('end', () => {
    received.push({
      method: req.method ?? '',
      url: req.url ?? '',
      contentType: String(req.headers['content-type'] ?? ''),
      body: Buffer.concat(chunks).toString('utf8'),
    })
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"status":"ok"}')
  })
})
await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r))

process.env.AUTH_DATA_DIR = dataDir
process.env.SESSION_SECRET = 'test-session-secret-for-proxy-author'
process.env.OXEN_UPSTREAM = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`

const { Hono } = await import('hono')
const { proxyToOxen } = await import('./proxy.js')
const { queryAudit } = await import('./audit.js')
const { ensurePrincipal } = await import('./authentication/session/session.js')
const { assignRole } = await import('./rbacStore.js')
const { createNamespaceAuthz } = await import('./authzNamespaceStore.js')
const { regulatedMutationHeaders } = await import('./testSupport.js')
const { openSignatureStore, useSignatureStore } = await import('./authentication/signing/signatureStore.js')
const { immudbConfig, openLedger } = await import('./auditLedger.js')
const { randomBytes } = await import('node:crypto')
useSignatureStore(
  openSignatureStore(
    await openLedger({ ...immudbConfig(), prefix: `proxy-author/${randomBytes(4).toString('hex')}/` }),
  ),
)

const alice = {
  sub: 'alice',
  iss: 'https://idp.example/',
  email: 'alice@example.com',
  name: 'Alice',
}
const stranger = {
  sub: 'stranger',
  iss: 'https://idp.example/',
  email: 'stranger@example.com',
  name: 'Stranger',
}
let actor = alice
await ensurePrincipal(alice)
assert.equal(
  (await assignRole({ actor: null, target: alice, role: 'manager', reason: 'test', bootstrap: true })).ok,
  true,
)
// Owner of namespaces exercised by author-injection writes (Admin no longer bypasses repo ACL).
assert.equal((await createNamespaceAuthz(alice, 'a', 'none')).ok, true)
assert.equal((await createNamespaceAuthz(alice, 'acme', 'none')).ok, true)

const app = new Hono()
app.all('/api/*', (c) => proxyToOxen(c, { user: actor, via: 'session' }))

async function send(
  path: string,
  init: { method?: string; contentType?: string; body?: BodyInit; signatureBody?: unknown },
) {
  const method = init.method ?? 'POST'
  const ct = (init.contentType ?? '').toLowerCase()
  let signatureBody: unknown = init.signatureBody ?? {}
  if (init.signatureBody === undefined && ct.includes('json') && typeof init.body === 'string') {
    try {
      signatureBody = JSON.parse(init.body) as unknown
    } catch {
      signatureBody = {}
    }
  }
  const signed = await regulatedMutationHeaders(actor, {
    method,
    path,
    body: signatureBody,
    reason: 'Routine test change',
    category: 'privileged_settings',
    jsonContentType: false,
  })
  return app.request(path, {
    method,
    headers: {
      ...signed,
      ...(init.contentType ? { 'content-type': init.contentType } : {}),
      'x-mice-change-control-id': 'CC-2026-114',
    },
    body: init.body,
  })
}

describe('proxy author injection fails closed', () => {
  beforeEach(() => {
    received = []
  })
  after(() => {
    upstream.close()
    rmSync(dataDir, { recursive: true, force: true })
  })

  it('writes canonical iss|sub as the author and the email at commit time', async () => {
    const message = 'add the assay table\n\nSubmitted-by: forged|person'
    const res = await send('/api/repos/a/b/branches', {
      contentType: 'application/json',
      body: JSON.stringify({ name: 'forged', email: 'forged@x.io', author: 'forged', message }),
    })
    assert.equal(res.status, 200)
    const sent = JSON.parse(received[0]!.body) as Record<string, string>
    assert.equal(sent.email, 'alice@example.com')
    assert.equal(sent.name, 'https://idp.example|alice')
    assert.equal(sent.author, 'https://idp.example|alice')
    assert.equal(sent.message, message)
  })

  it('injects the Principal as author on a multipart write', async () => {
    const form = new FormData()
    form.set('name', 'forged')
    form.set('email', 'forged@x.io')
    form.set('file', new Blob(['x']), 'a.txt')
    const path = '/api/repos/a/b/file/main/a.txt'
    const signed = await regulatedMutationHeaders(actor, {
      method: 'PUT',
      path,
      body: {},
      reason: 'Routine test change',
      category: 'privileged_settings',
      jsonContentType: false,
    })
    const res = await app.request(path, {
      method: 'PUT',
      body: form,
      headers: { ...signed, 'x-mice-change-control-id': 'CC-2026-114' },
    })
    assert.equal(res.status, 200)
    // The proxy first GETs the prior file entry for lineage; the PUT is the write.
    const put = received.find((r) => r.method === 'PUT')!
    assert.match(put.body, /alice@example\.com/)
    assert.match(put.body, /https:\/\/idp\.example\|alice/)
    assert.doesNotMatch(put.body, /forged@x\.io/)
  })

  it('rejects malformed multipart with 400 and sends nothing upstream', async () => {
    const res = await send('/api/repos/a/b/file/main/a.txt', {
      method: 'PUT',
      contentType: 'multipart/form-data; boundary=zzz',
      body: 'not a multipart body',
    })
    assert.equal(res.status, 400)
    assert.equal(received.length, 0)
  })

  it('accepts media types regardless of case and parameters', async () => {
    const res = await send('/api/repos/a/b/branches', {
      contentType: 'Application/JSON; charset=utf-8',
      body: JSON.stringify({ name: 'forged', email: 'forged@x.io', message: 'm' }),
    })
    assert.equal(res.status, 200)
    assert.equal(
      (JSON.parse(received[0]!.body) as Record<string, string>).email,
      'alice@example.com',
    )
  })

  it('rejects malformed JSON with 400 and sends nothing upstream', async () => {
    const res = await send('/api/repos/a/b/branches', {
      contentType: 'application/json',
      body: '{"email":"forged@x.io",',
    })
    assert.equal(res.status, 400)
    assert.equal(received.length, 0)
  })

  it('rejects a JSON body that is not an object', async () => {
    const res = await send('/api/repos/a/b/branches', {
      contentType: 'application/json',
      body: '["forged"]',
    })
    assert.equal(res.status, 400)
    assert.equal(received.length, 0)
  })

  it('passes an all-string path array on workspace unstage', async () => {
    const res = await send('/api/repos/a/b/workspaces/w1/changes', {
      method: 'DELETE',
      contentType: 'application/json',
      body: '["x.txt"]',
    })
    assert.equal(res.status, 200)
    assert.equal(received[0]!.body, '["x.txt"]')
  })

  it('passes an all-string path array on workspace file removal', async () => {
    const res = await send('/api/repos/a/b/workspaces/w1/files', {
      method: 'DELETE',
      contentType: 'application/json',
      body: '["x.txt"]',
    })
    assert.equal(res.status, 200)
  })

  it('rejects a non-empty body with an unclassified content type', async () => {
    const res = await send('/api/repos/a/b/branches', {
      contentType: 'application/x-www-form-urlencoded',
      body: 'email=forged%40x.io',
    })
    assert.equal(res.status, 400)
    assert.equal(received.length, 0)
  })

  it('rejects a non-empty body with no content type', async () => {
    const res = await send('/api/repos/a/b/branches', {
      body: new TextEncoder().encode('{"email":"forged@x.io"}'),
    })
    assert.equal(res.status, 400)
    assert.equal(received.length, 0)
  })

  it('still proxies binary uploads (author-free allowlist)', async () => {
    const res = await send('/api/repos/a/b/versions/abc/chunks?offset=0', {
      method: 'PUT',
      contentType: 'application/octet-stream',
      body: new Uint8Array([1, 2, 3]),
    })
    assert.equal(res.status, 200)
    assert.equal(received.length, 1)
  })

  it('rejects octet-stream on a non-allowlisted route', async () => {
    const res = await send('/api/repos/a/b/branches', {
      method: 'POST',
      contentType: 'application/octet-stream',
      body: new TextEncoder().encode('{"email":"forged@x.io"}'),
    })
    assert.equal(res.status, 400)
    assert.equal(received.length, 0)
  })

  it('rejects gzip on a non-allowlisted route', async () => {
    const res = await send('/api/repos/a/b/commits', {
      method: 'POST',
      contentType: 'application/gzip',
      body: new Uint8Array([31, 139, 8]),
    })
    assert.equal(res.status, 400)
    assert.equal(received.length, 0)
  })

  it('still proxies gzip hash queries (author-free allowlist)', async () => {
    const res = await send('/api/repos/a/b/versions', {
      method: 'QUERY',
      contentType: 'application/gzip',
      body: new Uint8Array([31, 139, 8]),
    })
    assert.equal(res.status, 200)
    assert.equal(received.length, 1)
  })

  it('still proxies bodyless writes', async () => {
    const res = await send('/api/repos/a/b/branches/x', { method: 'DELETE' })
    assert.equal(res.status, 200)
    assert.equal(received.length, 1)
  })

  it('rejects author-like query parameters on a bodyless write', async () => {
    const res = await send('/api/repos/a/b/branches/x?user_email=forged%40x.io', {
      method: 'DELETE',
    })
    assert.equal(res.status, 400)
    assert.equal(received.length, 0)
  })

  it('rejects author-like query parameters on a JSON write, case-insensitively', async () => {
    const res = await send('/api/repos/a/b/branches?Author=forged', {
      contentType: 'application/json',
      body: JSON.stringify({ name: 'x', message: 'm' }),
    })
    assert.equal(res.status, 400)
    assert.equal(received.length, 0)
  })

  it('leaves author-like query parameters alone on reads', async () => {
    const res = await app.request('/api/repos/a/b/commits?author=alice')
    assert.equal(res.status, 200)
    assert.equal(received.length, 1)
  })

  it('does not treat a plain name query parameter as an author', async () => {
    const res = await send('/api/repos/a/b/branches/x?name=main', { method: 'DELETE' })
    assert.equal(res.status, 200)
    assert.equal(received.length, 1)
  })

  it('overwrites nested author fields', async () => {
    await send('/api/repos/a/b/branches', {
      contentType: 'application/json',
      body: JSON.stringify({
        message: 'm',
        commit: { author: 'forged', email: 'forged@x.io', name: 'forged' },
        extra: [{ user_name: 'forged', user_email: 'forged@x.io' }],
      }),
    })
    const sent = JSON.parse(received[0]!.body)
    assert.deepEqual(sent.commit, {
      author: 'https://idp.example|alice',
      email: 'alice@example.com',
      name: 'https://idp.example|alice',
    })
    assert.deepEqual(sent.extra, [
      { user_name: 'https://idp.example|alice', user_email: 'alice@example.com' },
    ])
    assert.doesNotMatch(received[0]!.body, /forged/)
  })

  it('overwrites committer fields at the top level', async () => {
    await send('/api/repos/a/b/branches', {
      contentType: 'application/json',
      body: JSON.stringify({ committer: 'forged', committer_email: 'forged@x.io' }),
    })
    const sent = JSON.parse(received[0]!.body)
    assert.equal(sent.committer, 'https://idp.example|alice')
    assert.equal(sent.committer_email, 'alice@example.com')
  })

  it('leaves nested objects without author fields untouched', async () => {
    await send('/api/repos/a/b/branches', {
      contentType: 'application/json',
      body: JSON.stringify({ message: 'm', meta: { name: 'dataset', tags: ['x'] } }),
    })
    const sent = JSON.parse(received[0]!.body)
    assert.deepEqual(sent.meta, { name: 'dataset', tags: ['x'] })
  })

  it('does not treat a repository create body as an author', async () => {
    await send('/api/repos', {
      contentType: 'application/json',
      body: JSON.stringify({ namespace: 'acme', name: 'data' }),
    })
    assert.deepEqual(JSON.parse(received[0]!.body), { namespace: 'acme', name: 'data' })
  })

  it('records the same iss, sub, and email on the audit actor', async () => {
    const message = 'record the assay batch'
    const res = await send('/api/repos/a/b/branches', {
      contentType: 'application/json',
      body: JSON.stringify({ name: 'forged', email: 'forged@x.io', message }),
    })
    assert.equal(res.status, 200)
    const sent = JSON.parse(received[0]!.body) as Record<string, string>
    const events = (await queryAudit({ action: 'branch.create', limit: 100 })).events
    const event = events.find((e) => e.message === message)
    assert.ok(event)
    assert.equal(event.actor.iss, 'https://idp.example')
    assert.equal(event.actor.sub, 'alice')
    assert.equal(event.actor.email, 'alice@example.com')
    assert.equal(sent.author, 'https://idp.example|alice')
    assert.equal(sent.email, 'alice@example.com')
  })

  it('answers 403, not 400, and writes no rejection row for an unauthorized Principal', async () => {
    actor = stranger
    try {
      const before = (await queryAudit({ action: 'request.rejected', limit: 100 })).events.length
      const res = await send('/api/repos/a/b/branches', {
        contentType: 'application/json',
        body: 'not json',
      })
      assert.equal(res.status, 403)
      assert.equal(received.length, 0)
      assert.equal(
        (await queryAudit({ action: 'request.rejected', limit: 100 })).events.length,
        before,
      )
    } finally {
      actor = alice
    }
  })

  it('records namespace and repo on the rejection row', async () => {
    await send('/api/repos/acme/data/branches', {
      contentType: 'application/json',
      body: 'not json',
    })
    const [event] = (await queryAudit({ action: 'request.rejected', limit: 1 })).events
    assert.equal(event!.namespace, 'acme')
    assert.equal(event!.repo, 'data')
  })

  it('audits the rejection', async () => {
    const before = (await queryAudit({ action: 'request.rejected', limit: 100 })).events.length
    await send('/api/repos/a/b/branches', {
      contentType: 'application/json',
      body: 'not json',
    })
    const events = (await queryAudit({ action: 'request.rejected', limit: 100 })).events
    assert.equal(events.length, before + 1)
    assert.equal(events[0]!.status, 400)
    assert.equal(events[0]!.actor.sub, 'alice')
  })
})
