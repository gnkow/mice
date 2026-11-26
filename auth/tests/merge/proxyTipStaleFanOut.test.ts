import '../../src/db/testSchema.js'
import assert from 'node:assert/strict'
import { after, afterEach, beforeEach, describe, it } from 'node:test'
import { Hono } from 'hono'
import { isolatedAuth, regulatedMutationHeaders } from '../../src/packages/shared/lib/testSupport.js'

/**
 * Seam: proxy tip-changing fan-out → TipSync (#158).
 * Catches: commit.publish (no branch in path) and branch-known tip writes mark open MRs stale.
 * Misses: validated-branch registry (#116); UI Outdated badge.
 */
const iso = isolatedAuth({ OXEN_UPSTREAM: 'http://oxen.invalid' })
after(() => iso.restore())

const { proxyToOxen, setUpstreamFetch } = await import('../../src/packages/proxy/lib/proxy.js')
const { preparePrincipal } = await import('../../src/packages/authz/lib/authz.js')
const { createNamespaceAuthz } = await import('../../src/packages/authz/lib/authzNamespaceStore.js')
const { ensureRepository } = await import('../../src/packages/authz/lib/repositoryStore.js')
const { setRepoCollaborator } = await import('../../src/packages/authz/lib/authzCollaboratorStore.js')
const { openMergeRequest, getMergeRequest } = await import(
  '../../src/packages/merge/lib/mergeRequestStore.js'
)

const writer = iso.person('writer')
await preparePrincipal(writer)
await iso.grantRole(writer, 'user')
assert.equal((await createNamespaceAuthz(iso.admin, 'fan', 'none')).ok, true)
const repo = await ensureRepository('fan', 'r')
assert.ok(repo)
await setRepoCollaborator('fan', 'r', writer, 'write')

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const app = new Hono()
app.all('/api/*', (c) => proxyToOxen(c, { user: writer, via: 'session' }))

let branchTips: Record<string, string>
let restoreUpstream: () => void

beforeEach(() => {
  branchTips = { main: 'main-old', feature: 'feat-old', develop: 'dev-old' }
  restoreUpstream = setUpstreamFetch(async (url, init) => {
    const path = new URL(String(url)).pathname
    const method = (init?.method ?? 'GET').toUpperCase()
    if (method === 'GET' && /\/branches\/[^/]+$/.test(path)) {
      const branch = decodeURIComponent(path.split('/').pop()!)
      const tip = branchTips[branch]
      if (!tip) return json({ status: 'error' }, 404)
      return json({ branch: { name: branch, commit_id: tip } })
    }
    if (method === 'POST' && /\/commits\/[^/]+\/complete$/.test(path)) {
      return json({ status: 'ok', commit: { id: path.split('/').at(-2) } })
    }
    if (method === 'PUT' && /\/branches\/[^/]+$/.test(path)) {
      const branch = decodeURIComponent(path.split('/').pop()!)
      const nextTip = 'feat-new'
      branchTips[branch] = nextTip
      return json({ branch: { name: branch, commit_id: nextTip } })
    }
    return json({}, 404)
  })
})
afterEach(() => restoreUpstream())

describe('proxy tip stale fan-out (#158)', () => {
  it('commit.publish marks open MRs stale when the published tip is a pinned branch', async () => {
    const mr = await openMergeRequest({
      repositoryId: repo.id,
      namespace: 'fan',
      repo: 'r',
      sourceBranch: 'feature',
      targetBranch: 'main',
      expectedSourceHead: 'feat-old',
      expectedTargetHead: 'main-old',
      openedBy: { iss: writer.iss, sub: writer.sub },
    })

    branchTips.main = 'c77-published'
    const path = '/api/repos/fan/r/commits/c77-published/complete'
    const signed = await regulatedMutationHeaders(writer, {
      method: 'POST',
      path,
      body: {},
      reason: 'Publish plate run onto feature branch tip',
    })
    const res = await app.request(path, {
      method: 'POST',
      headers: {
        ...(await iso.sessionHeaders(writer)),
        ...signed,
        'x-mice-change-control-id': 'CC-2026-158',
      },
      body: JSON.stringify({}),
    })
    assert.equal(res.status, 200, await res.clone().text())
    assert.equal((await getMergeRequest(mr.id))?.status, 'stale')
  })

  it('branch-known tip write still marks open MRs stale', async () => {
    const mr = await openMergeRequest({
      repositoryId: repo.id,
      namespace: 'fan',
      repo: 'r',
      sourceBranch: 'feature',
      targetBranch: 'develop',
      expectedSourceHead: 'feat-old',
      expectedTargetHead: 'dev-old',
      openedBy: { iss: writer.iss, sub: writer.sub },
    })

    const path = '/api/repos/fan/r/branches/feature'
    const signed = await regulatedMutationHeaders(writer, {
      method: 'PUT',
      path,
      body: { commit_id: 'feat-new' },
      reason: 'Move feature tip after review feedback',
    })
    const res = await app.request(path, {
      method: 'PUT',
      headers: {
        ...(await iso.sessionHeaders(writer)),
        ...signed,
        'content-type': 'application/json',
        'x-mice-change-control-id': 'CC-2026-158b',
      },
      body: JSON.stringify({ commit_id: 'feat-new' }),
    })
    assert.equal(res.status, 200, await res.clone().text())
    assert.equal((await getMergeRequest(mr.id))?.status, 'stale')
  })
})
