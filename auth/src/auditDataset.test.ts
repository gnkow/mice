import './db/testSchema.js'
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { isolatedAuth } from './testSupport.js'

const iso = isolatedAuth({ OXEN_UPSTREAM: 'http://oxen.invalid' })
const { createApp } = await import('./app.js')
const { setUpstreamFetch } = await import('./proxy.js')
const { preparePrincipal } = await import('./authz.js')
const { createNamespaceAuthz } = await import('./authzNamespaceStore.js')
const { immudbConfig, openLedger } = await import('./auditLedger.js')

const ledger = await openLedger(immudbConfig())
let since = 0
const admin = iso.admin
await preparePrincipal(admin)
await createNamespaceAuthz(admin, 'ds', 'none', true)

type Row = {
  action: string
  phase?: string
  status: number
  dataset?: { base?: string; head?: string }
  unverified?: boolean
}
const outcome = async (action: string) =>
  (await ledger.readAll())
    .filter((r) => r.seq > since)
    .map((r) => JSON.parse(r.value) as Row)
    .filter((r) => r.phase === 'outcome' && r.action === action)
    .at(-1)

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

let branchHead: unknown
let writeAnswer: () => Response
let restoreUpstream: () => void
const app = createApp()

beforeEach(async () => {
  since = (await ledger.readAll()).reduce((m, r) => Math.max(m, r.seq), 0)
  branchHead = { branch: { name: 'main', commit_id: 'c0' } }
  writeAnswer = () => json({ status: 'ok', commit: { id: 'c1' } })
  restoreUpstream = setUpstreamFetch(async (url, init) => {
    const path = new URL(String(url)).pathname
    if (!init?.method || init.method === 'GET') {
      if (path.endsWith('/branches/main')) return branchHead ? json(branchHead) : json({}, 404)
      // Self-merge check GETs the merge range before POST; authors must not include the admin.
      if (path.includes('/merge/')) {
        return json({ is_mergeable: true, conflicts: [], commits: [{ id: 'c1', author: 'other|user' }] })
      }
      return json({}, 404)
    }
    return writeAnswer()
  })
})
afterEach(() => restoreUpstream())

const send = async (method: string, path: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: {
      ...(await iso.sessionHeaders(admin)),
      'content-type': 'application/json',
      'x-mice-reason': 'Routine dataset change',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

describe('dataset versions on dataset mutations', () => {
  it('records the branch head before and the resulting commit after a file write', async () => {
    assert.equal((await send('PUT', '/api/repos/ds/r/file/main/a.csv', { message: 'fix' })).status, 200)
    const o = (await outcome('file.write'))!
    assert.deepEqual(o.dataset, { base: 'c0', head: 'c1' })
    assert.equal(o.unverified, undefined)
  })

  it('marks the event unverified when the resulting commit cannot be determined', async () => {
    writeAnswer = () => json({ status: 'ok' })
    assert.equal((await send('PUT', '/api/repos/ds/r/file/main/a.csv', { message: 'fix' })).status, 200)
    const o = (await outcome('file.write'))!
    assert.deepEqual(o.dataset, { base: 'c0' })
    assert.equal(o.unverified, true)
  })

  it('still records the head when the base cannot be read', async () => {
    branchHead = undefined
    await send('PUT', '/api/repos/ds/r/file/main/a.csv', { message: 'fix' })
    const o = (await outcome('file.write'))!
    assert.deepEqual(o.dataset, { head: 'c1' })
    assert.equal(o.unverified, undefined)
  })

  it('records nothing for a refused mutation', async () => {
    writeAnswer = () => json({ status: 'error' }, 409)
    assert.equal((await send('PUT', '/api/repos/ds/r/file/main/a.csv', { message: 'fix' })).status, 409)
    const o = (await outcome('file.write'))!
    assert.equal(o.dataset, undefined)
    assert.equal(o.unverified, undefined)
  })

  it('reads the head from branch, merge and publish answers', async () => {
    writeAnswer = () => json({ branch: { name: 'main', commit_id: 'c9' } })
    await send('PUT', '/api/repos/ds/r/branches/main', { commit_id: 'c9' })
    assert.deepEqual((await outcome('branch.update'))!.dataset, { base: 'c0', head: 'c9' })

    writeAnswer = () => json({ commits: { base: { id: 'a' }, head: { id: 'b' }, merge: { id: 'm1' } } })
    await send('POST', '/api/repos/ds/r/merge/main..feature', {})
    assert.deepEqual((await outcome('merge'))!.dataset, { base: 'c0', head: 'm1' })

    writeAnswer = () => json({ status: 'ok' })
    await send('POST', '/api/repos/ds/r/commits/c77/complete')
    assert.deepEqual((await outcome('commit.publish'))!.dataset, { head: 'c77' })
  })

  it('does not apply to mutations that make no dataset version', async () => {
    writeAnswer = () => json({ status: 'ok' })
    await send('DELETE', '/api/repos/ds/r/branches/old')
    const o = (await outcome('branch.delete'))!
    assert.equal(o.dataset, undefined)
    assert.equal(o.unverified, undefined)
  })

  it('shows versions and the unverified marker in the CSV export', async () => {
    await send('PUT', '/api/repos/ds/r/file/main/a.csv', { message: 'fix' })
    writeAnswer = () => json({ status: 'ok' })
    await send('PUT', '/api/repos/ds/r/file/main/b.csv', { message: 'fix' })
    const csv = await (await app.request('/auth/audit/export.csv', { headers: await iso.sessionHeaders(admin) })).text()
    const [header, ...lines] = csv.trim().split('\r\n')
    const cols = header!.split(',')
    const cells = (name: string) => lines.filter((l) => l.includes('file.write')).slice(-2).map((l) => l.split(',')[cols.indexOf(name)])
    assert.deepEqual(cells('dataset_base'), ['c0', 'c0'])
    assert.deepEqual(cells('dataset_head'), ['', 'c1'])
    assert.deepEqual(cells('unverified'), ['true', ''])
  })
})
