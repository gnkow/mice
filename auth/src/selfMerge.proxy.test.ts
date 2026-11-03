import './db/testSchema.js'
import assert from 'node:assert/strict'
import { after, afterEach, beforeEach, describe, it } from 'node:test'
import { isolatedAuth } from './testSupport.js'
import { SELF_MERGE_FORBIDDEN } from './selfMerge.js'

const iso = isolatedAuth({ OXEN_UPSTREAM: 'http://oxen.invalid' })
const { createApp } = await import('./app.js')
const { setUpstreamFetch } = await import('./proxy.js')
const { preparePrincipal } = await import('./authz.js')
const { setRepoCollaborator } = await import('./authzCollaboratorStore.js')
const { createNamespaceAuthz } = await import('./authzNamespaceStore.js')
const { immudbConfig, openLedger } = await import('./auditLedger.js')

const ledger = await openLedger(immudbConfig())
let since = 0

const admin = iso.admin
const merger = iso.person('merger')
await preparePrincipal(admin)
await iso.grantRole(admin, 'manager')
await iso.grantRole(merger, 'user')
await createNamespaceAuthz(admin, 'sm', 'none', true)
await setRepoCollaborator('sm', 'r', merger, 'maintain')

const mergerAuthor = 'test|merger'
const otherAuthor = 'test|other'

type Row = {
  action: string
  phase?: string
  status: number
  detail?: { authors?: string[]; reason?: string; self_merge?: boolean }
}
const outcomes = async (action: string) =>
  (await ledger.readAll())
    .filter((r) => r.seq > since)
    .map((r) => JSON.parse(r.value) as Row)
    .filter((r) => r.phase === 'outcome' && r.action === action)

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

let mergeCommits: Array<{ author: string; id?: string }>
let postMergeHits: number
let restoreUpstream: () => void
const app = createApp()

beforeEach(async () => {
  since = (await ledger.readAll()).reduce((m, r) => Math.max(m, r.seq), 0)
  mergeCommits = [{ id: 'c1', author: otherAuthor }]
  postMergeHits = 0
  restoreUpstream = setUpstreamFetch(async (url, init) => {
    const path = new URL(String(url)).pathname
    const method = (init?.method ?? 'GET').toUpperCase()
    if (method === 'GET' && path.includes('/merge/')) {
      return json({
        status: 'success',
        is_mergeable: true,
        conflicts: [],
        commits: mergeCommits,
      })
    }
    if (method === 'GET' && path.includes('/branches/')) {
      return json({ branch: { name: 'main', commit_id: 'c0' } })
    }
    if (method === 'POST' && path.includes('/merge/')) {
      postMergeHits += 1
      return json({
        status: 'success',
        commits: {
          base: { id: 'c0', author: otherAuthor },
          head: { id: 'c1', author: otherAuthor },
          merge: { id: 'm1', author: mergerAuthor },
        },
      })
    }
    return json({}, 404)
  })
})
afterEach(() => restoreUpstream())
after(() => iso.restore())

async function mergeAs(person: typeof merger) {
  return app.request('/api/repos/sm/r/merge/main..feature', {
    method: 'POST',
    headers: {
      ...(await iso.sessionHeaders(person)),
      'content-type': 'application/json',
      'x-mice-reason': 'Independent merge review for assay data',
    },
    body: JSON.stringify({ name: 'x', email: 'x@x.io' }),
  })
}

describe('self-merge prevention on merge proxy', () => {
  it('lets a maintainer merge commits authored by someone else', async () => {
    const res = await mergeAs(merger)
    assert.equal(res.status, 200)
    assert.equal(postMergeHits, 1)
    const o = (await outcomes('merge')).at(-1)!
    assert.equal(o.status, 200)
  })

  it('rejects merge when the signer authored a commit in the range', async () => {
    mergeCommits = [
      { id: 'c1', author: otherAuthor },
      { id: 'c2', author: mergerAuthor },
    ]
    const res = await mergeAs(merger)
    const body = (await res.json()) as { error?: { detail?: string } }
    assert.equal(res.status, 403)
    assert.equal(body.error?.detail, SELF_MERGE_FORBIDDEN)
    assert.equal(postMergeHits, 0)
  })

  it('audits a denied self-merge with signer authors and reason', async () => {
    mergeCommits = [{ id: 'c2', author: mergerAuthor }]
    await mergeAs(merger)
    const o = (await outcomes('merge')).at(-1)!
    assert.equal(o.status, 403)
    assert.equal(o.detail?.reason, SELF_MERGE_FORBIDDEN)
    assert.ok(o.detail?.authors?.includes(mergerAuthor))
    assert.equal(o.detail?.self_merge, true)
  })

  it('rejects when any of several authors matches the signer', async () => {
    mergeCommits = [
      { id: 'a', author: otherAuthor },
      { id: 'b', author: mergerAuthor },
      { id: 'c', author: 'test|carol' },
    ]
    const res = await mergeAs(merger)
    assert.equal(res.status, 403)
    assert.equal(postMergeHits, 0)
  })
})
