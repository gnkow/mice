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
const { setAuthzEnforce } = await import('./authzStore.js')

const alice = {
  sub: 'alice',
  iss: 'test',
  email: 'alice@example.com',
  name: 'Alice',
}

const app = new Hono()
app.all('/api/*', (c) => proxyToOxen(c, { user: alice, via: 'session' }))

function send(
  path: string,
  init: { method?: string; contentType?: string; body?: BodyInit },
) {
  return app.request(path, {
    method: init.method ?? 'POST',
    headers: init.contentType ? { 'content-type': init.contentType } : {},
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

  it('injects the Principal as author on a valid JSON write', async () => {
    const res = await send('/api/repos/a/b/branches', {
      contentType: 'application/json',
      body: JSON.stringify({ name: 'forged', email: 'forged@x.io', message: 'm' }),
    })
    assert.equal(res.status, 200)
    const sent = JSON.parse(received[0]!.body) as Record<string, string>
    assert.equal(sent.email, 'alice@example.com')
    assert.equal(sent.name, 'Alice')
  })

  it('injects the Principal as author on a multipart write', async () => {
    const form = new FormData()
    form.set('name', 'forged')
    form.set('email', 'forged@x.io')
    form.set('file', new Blob(['x']), 'a.txt')
    const res = await app.request('/api/repos/a/b/file/main/a.txt', {
      method: 'PUT',
      body: form,
    })
    assert.equal(res.status, 200)
    // The proxy first GETs the prior file entry for lineage; the PUT is the write.
    const put = received.find((r) => r.method === 'PUT')!
    assert.match(put.body, /alice@example\.com/)
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
    const res = await send('/api/repos/a/b/chunks/abc', {
      method: 'PUT',
      contentType: 'application/octet-stream',
      body: new Uint8Array([1, 2, 3]),
    })
    assert.equal(res.status, 200)
    assert.equal(received.length, 1)
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

  it('answers 403, not 400, and writes no rejection row for an unauthorized Principal', async () => {
    setAuthzEnforce(true)
    try {
      const before = queryAudit({ action: 'request.rejected', limit: 100 }).events.length
      const res = await send('/api/repos/a/b/branches', {
        contentType: 'application/json',
        body: 'not json',
      })
      assert.equal(res.status, 403)
      assert.equal(received.length, 0)
      assert.equal(
        queryAudit({ action: 'request.rejected', limit: 100 }).events.length,
        before,
      )
    } finally {
      setAuthzEnforce(false)
    }
  })

  it('records namespace and repo on the rejection row', async () => {
    await send('/api/repos/acme/data/branches', {
      contentType: 'application/json',
      body: 'not json',
    })
    const [event] = queryAudit({ action: 'request.rejected', limit: 1 }).events
    assert.equal(event!.namespace, 'acme')
    assert.equal(event!.repo, 'data')
  })

  it('audits the rejection', async () => {
    const before = queryAudit({ action: 'request.rejected', limit: 100 }).events.length
    await send('/api/repos/a/b/branches', {
      contentType: 'application/json',
      body: 'not json',
    })
    const events = queryAudit({ action: 'request.rejected', limit: 100 }).events
    assert.equal(events.length, before + 1)
    assert.equal(events[0]!.status, 400)
    assert.equal(events[0]!.actor.sub, 'alice')
  })
})
