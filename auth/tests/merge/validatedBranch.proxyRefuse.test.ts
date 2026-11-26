import '../../src/db/testSchema.js'
import assert from 'node:assert/strict'
import { after, afterEach, beforeEach, describe, it } from 'node:test'
import { Hono } from 'hono'
import { isolatedAuth, regulatedMutationHeaders } from '../../src/packages/shared/lib/testSupport.js'

/**
 * Seam: proxy validated-branch refuse matrix (#116).
 * Catches: file write, push complete, branch delete, branch update on validated tips.
 * Misses: UI; signed unmark (#119).
 */
const iso = isolatedAuth({ OXEN_UPSTREAM: 'http://oxen.invalid' })
after(() => iso.restore())

const { proxyToOxen, setUpstreamFetch } = await import('../../src/packages/proxy/lib/proxy.js')
const { preparePrincipal } = await import('../../src/packages/authz/lib/authz.js')
const { createNamespaceAuthz } = await import('../../src/packages/authz/lib/authzNamespaceStore.js')
const { ensureRepository } = await import('../../src/packages/authz/lib/repositoryStore.js')
const { setRepoCollaborator } = await import('../../src/packages/authz/lib/authzCollaboratorStore.js')
const {
  ensureDefaultBranchValidated,
  markBranchValidated,
} = await import('../../src/packages/merge/index.js')

const writer = iso.person('vb-proxy-writer')
await preparePrincipal(writer)
await iso.grantRole(writer, 'user')
assert.equal((await createNamespaceAuthz(iso.admin, 'vb-px', 'none')).ok, true)
const repo = await ensureRepository('vb-px', 'r')
assert.ok(repo)
await ensureDefaultBranchValidated(repo.id, 'main')
await setRepoCollaborator('vb-px', 'r', writer, 'maintain')
await markBranchValidated({
  repositoryId: repo.id,
  branch: 'feature',
  markedBy: 'test|admin',
  reason: 'Feature line validated for refuse matrix',
  changeControlId: 'CC-2026-116-px',
})

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const app = new Hono()
app.all('/api/*', (c) => proxyToOxen(c, { user: writer, via: 'session' }))

let restoreUpstream: () => void
let upstreamHits = 0

beforeEach(() => {
  upstreamHits = 0
  restoreUpstream = setUpstreamFetch(async (url, init) => {
    upstreamHits += 1
    const path = new URL(String(url)).pathname
    const method = (init?.method ?? 'GET').toUpperCase()
    if (method === 'GET' && path.endsWith('/branches')) {
      return json({
        branches: [
          { name: 'main', commit_id: 'main-tip' },
          { name: 'feature', commit_id: 'feat-tip' },
          { name: 'develop', commit_id: 'dev-tip' },
        ],
      })
    }
    if (method === 'GET' && /\/commits\/[^/]+$/.test(path)) {
      return json({ commit: { id: path.split('/').pop(), parent_ids: ['main-tip'] } })
    }
    if (method === 'GET' && /\/branches\/[^/]+$/.test(path)) {
      return json({ branch: { name: 'x', commit_id: 'tip' } })
    }
    return json({ status: 'ok' })
  })
})
afterEach(() => restoreUpstream())

async function refuse(path: string, method: string, body: Record<string, unknown> = {}) {
  const signed = await regulatedMutationHeaders(writer, {
    method,
    path,
    body,
    reason: 'Attempt tip-changing write on validated branch for refuse matrix',
  })
  const res = await app.request(path, {
    method,
    headers: {
      ...(await iso.sessionHeaders(writer)),
      ...signed,
      'content-type': 'application/json',
      'x-mice-change-control-id': `CC-2026-116-${method}-${path.length}`,
    },
    body: Object.keys(body).length ? JSON.stringify(body) : undefined,
  })
  const payload = (await res.json()) as { error?: { code?: string; detail?: string } }
  return { res, payload }
}

describe('proxy validated-branch refuse matrix (#116)', () => {
  it('refuses file.write on validated default without reaching oxen', async () => {
    const { res, payload } = await refuse('/api/repos/vb-px/r/file/main/a.csv', 'PUT', {
      contents: 'x',
    })
    assert.equal(res.status, 403)
    assert.equal(payload.error?.code, 'validated_branch')
    assert.match(payload.error?.detail ?? '', /Validated branch/i)
    assert.equal(upstreamHits, 0)
  })

  it('refuses file.write on Owner-marked feature; allows develop', async () => {
    const blocked = await refuse('/api/repos/vb-px/r/file/feature/a.csv', 'PUT', { contents: 'x' })
    assert.equal(blocked.res.status, 403)
    assert.equal(blocked.payload.error?.code, 'validated_branch')

    const allowed = await refuse('/api/repos/vb-px/r/file/develop/a.csv', 'PUT', { contents: 'x' })
    assert.equal(allowed.res.status, 200)
  })

  it('refuses branch.delete and branch.update on validated main', async () => {
    const del = await refuse('/api/repos/vb-px/r/branches/main', 'DELETE')
    assert.equal(del.res.status, 403)
    assert.equal(del.payload.error?.code, 'validated_branch')

    const upd = await refuse('/api/repos/vb-px/r/branches/main', 'PUT', { commit_id: 'x' })
    assert.equal(upd.res.status, 403)
    assert.equal(upd.payload.error?.code, 'validated_branch')
  })

  it('refuses commit.publish when parents match the validated tip', async () => {
    const path = '/api/repos/vb-px/r/commits/c-new/complete'
    const { res, payload } = await refuse(path, 'POST', {})
    assert.equal(res.status, 403)
    assert.equal(payload.error?.code, 'validated_branch')
  })

  it('refuses commit.upload when body names a validated branch', async () => {
    const path = '/api/repos/vb-px/r/commits/c-up/upload'
    const { res, payload } = await refuse(path, 'POST', { branch: 'main' })
    assert.equal(res.status, 403)
    assert.equal(payload.error?.code, 'validated_branch')
  })
})
