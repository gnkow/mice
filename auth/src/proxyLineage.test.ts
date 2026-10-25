import './db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { isolatedAuth } from './testSupport.js'

const ctx = isolatedAuth({ OXEN_UPSTREAM: 'http://oxen.invalid' })
after(() => ctx.restore())

const { Hono } = await import('hono')
const { proxyToOxen, setUpstreamFetch } = await import('./proxy.js')
const { preparePrincipal } = await import('./authz.js')
const { queryLineage } = await import('./lineage.js')
const { queryAudit } = await import('./audit.js')

const admin = ctx.admin
await preparePrincipal(admin)

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** A fake oxen: `entries` are the successive answers of the file's /meta lookup. */
function fakeOxen(opts: { entries: Array<unknown | null>; write: () => Response }) {
  const calls: string[] = []
  let metaCalls = 0
  const restore = setUpstreamFetch(async (url, init) => {
    const u = String(url)
    calls.push(`${init?.method ?? 'GET'} ${new URL(u).pathname}`)
    if (u.includes('/meta/')) {
      const entry = opts.entries[Math.min(metaCalls++, opts.entries.length - 1)]
      return entry ? json({ entry }) : json({ status: 'error' }, 404)
    }
    return opts.write()
  })
  return { calls, restore }
}

const app = new Hono()
app.all('/api/*', (c) => proxyToOxen(c, { user: admin, via: 'session' }))
const put = (repo: string) => {
  const form = new FormData()
  form.append('file', new Blob(['a,b\n1,2\n']), 'data.csv')
  return app.request(`/api/repos/lin/${repo}/file/main/data.csv`, { method: 'PUT', body: form, headers: { 'x-mice-reason': 'Routine test change' } })
}

await describe('proxy lineage capture', async () => {
  await it('snapshots before the write and records an edit with prior and new versions after it', async () => {
    const oxen = fakeOxen({
      entries: [{ hash: 'h1', latest_commit: { id: 'c0' } }, { hash: 'h2' }],
      write: () => json({ status: 'ok', commit: { id: 'c1' } }),
    })
    try {
      const res = await put('edit')
      assert.deepEqual([res.status, await res.json()], [200, { status: 'ok', commit: { id: 'c1' } }])
    } finally {
      oxen.restore()
    }
    assert.deepEqual(oxen.calls.map((c) => c.split(' ')[0]), ['GET', 'GET', 'PUT', 'GET'])
    const op = (await queryLineage({ namespace: 'lin', repo: 'edit' })).operations[0]!
    assert.equal(op.kind, 'edit')
    assert.deepEqual(op.inputs.map((v) => [v.contentHash, v.commitId]), [['h1', 'c0']])
    assert.deepEqual(op.outputs.map((v) => [v.contentHash, v.commitId]), [['h2', 'c1']])
    const audit = (await queryAudit({ action: 'file.write' })).events.find((e) => e.repo === 'edit')!
    assert.equal(audit.detail?.lineage_kind, 'edit')
    assert.equal(op.auditEventId, audit.id)
  })

  await it('records an upload when nothing existed before the write', async () => {
    const oxen = fakeOxen({
      entries: [null, { hash: 'h9' }],
      write: () => json({ status: 'ok', commit: { id: 'c9' } }),
    })
    try {
      await put('upload')
    } finally {
      oxen.restore()
    }
    const op = (await queryLineage({ namespace: 'lin', repo: 'upload' })).operations[0]!
    assert.equal(op.kind, 'upload')
    assert.deepEqual(op.inputs, [])
  })

  await it('records nothing and passes the response through when the upstream write fails', async () => {
    const oxen = fakeOxen({
      entries: [{ hash: 'h1' }],
      write: () => json({ status: 'error' }, 500),
    })
    let res: Response
    try {
      res = await put('failed')
    } finally {
      oxen.restore()
    }
    assert.equal(res.status, 500)
    assert.deepEqual(oxen.calls.map((c) => c.split(' ')[0]), ['GET', 'GET', 'PUT'])
    assert.equal((await queryLineage({ namespace: 'lin', repo: 'failed' })).operations.length, 0)
  })

  await it('does not capture reads', async () => {
    const oxen = fakeOxen({ entries: [null], write: () => json({ status: 'ok' }) })
    try {
      await app.request('/api/repos/lin/reads/file/main/data.csv')
    } finally {
      oxen.restore()
    }
    assert.deepEqual(oxen.calls, ['GET /api/repos/lin/reads/file/main/data.csv'])
  })
})
