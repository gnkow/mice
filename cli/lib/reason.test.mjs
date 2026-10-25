import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { describe, it } from 'node:test'
import { api } from './api.mjs'
import { buildRequest } from './admin.mjs'
import { declareReason, explainApiError, extractReason, reasonHeaders } from './reason.mjs'

describe('extractReason', () => {
  it('strips --reason in both spellings and returns the text', () => {
    assert.deepEqual(extractReason(['push', '--reason', 'fix labels', 'origin']), {
      args: ['push', 'origin'],
      reason: 'fix labels',
    })
    assert.deepEqual(extractReason(['rm', '--reason=remove duplicate rows', 'a.csv']), {
      args: ['rm', 'a.csv'],
      reason: 'remove duplicate rows',
    })
  })
  it('leaves argv alone without the flag and rejects a missing value', () => {
    assert.deepEqual(extractReason(['status']), { args: ['status'], reason: undefined })
    assert.throws(() => extractReason(['push', '--reason']), /--reason needs a value/)
  })
})

describe('reasonHeaders', () => {
  it('sends X-Mice-Reason only on mutating methods', () => {
    assert.deepEqual(reasonHeaders('PUT', 'because we said so'), { 'x-mice-reason': 'because we said so' })
    assert.deepEqual(reasonHeaders('GET', 'because we said so'), {})
    assert.deepEqual(reasonHeaders('PUT', undefined), {})
  })
})

describe('explainApiError', () => {
  it('turns the BFF reason rejections into a hint naming --reason', () => {
    const native = explainApiError(400, { error: 'x', code: 'reason_required' })
    assert.match(native, /--reason/)
    const proxied = explainApiError(400, {
      status_message: 'reason_too_short',
      error: { detail: 'The commit message is 3 characters; at least 10 are required.' },
    })
    assert.match(proxied, /3 characters/)
    assert.match(proxied, /--reason/)
  })
  it('keeps other errors readable, including oxen-shaped ones', () => {
    assert.equal(explainApiError(403, { status_message: 'forbidden', error: { detail: 'nope' } }), '403: nope')
    assert.equal(explainApiError(500, { error: 'boom' }), '500: boom')
  })
})

describe('--reason on admin requests', () => {
  it('api() forwards the header and surfaces the too-short message', async () => {
    let seen
    const server = createServer((req, res) => {
      seen = req.headers['x-mice-reason']
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'reason must be longer', code: 'reason_too_short' }))
    })
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    const remote = `http://127.0.0.1:${server.address().port}`
    try {
      const req = buildRequest('namespace', ['create', 'acme', '--base-permission', 'read'])
      await assert.rejects(
        api(remote, 't', req.path, { method: req.method, headers: reasonHeaders(req.method, 'short') }),
        /reason must be longer[\s\S]*--reason/,
      )
      assert.equal(seen, 'short')
    } finally {
      server.close()
    }
  })
})

describe('declareReason', () => {
  it('posts the reason to /auth/reason with the token', async () => {
    let seen
    const server = createServer((req, res) => {
      let b = ''
      req.on('data', (d) => (b += d))
      req.on('end', () => {
        seen = { url: req.url, auth: req.headers.authorization, body: JSON.parse(b) }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end('{"ok":true}')
      })
    })
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    const remote = `http://127.0.0.1:${server.address().port}`
    try {
      await declareReason(remote, 'tok', 'correct mislabeled rows')
      assert.equal(seen.url, '/auth/reason')
      assert.match(seen.auth, /tok$/)
      assert.equal(seen.body.reason, 'correct mislabeled rows')
    } finally {
      server.close()
    }
  })
})
