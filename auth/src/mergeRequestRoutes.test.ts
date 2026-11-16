import './db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { randomBytes } from 'node:crypto'
import { Hono } from 'hono'
import { isolatedAuth, regulatedMutationHeaders, sealedSessionCookie } from './testSupport.js'

const t = isolatedAuth({ AUTHZ_BOOTSTRAP_ADMINS: 'root@x.io' })
after(() => t.restore())

const { createNamespaceAuthz } = await import('./authzNamespaceStore.js')
const { ensureRepository } = await import('./repositoryStore.js')
const { preparePrincipal } = await import('./authz.js')
const { registerMergeRequestRoutes } = await import('./mergeRequestRoutes.js')
const { openSignatureStore, useSignatureStore } = await import('./authentication/signing/signatureStore.js')
const { immudbConfig, openLedger } = await import('./auditLedger.js')

useSignatureStore(
  openSignatureStore(
    await openLedger({ ...immudbConfig(), prefix: `mr-http/${randomBytes(4).toString('hex')}/` }),
  ),
)

const manager = t.person('manager')
await preparePrincipal(manager)
await t.grantRole(manager, 'manager')
assert.deepEqual(await createNamespaceAuthz(manager, 'mr-ns', 'none'), { ok: true })
const repo = await ensureRepository('mr-ns', 'study')
assert.ok(repo)

const app = new Hono()
registerMergeRequestRoutes(app, { audit: async () => {} })

const cookie = async () =>
  sealedSessionCookie({ ...manager, sessionStart: Math.floor(Date.now() / 1000) })

describe('merge request HTTP (repositories/02+03)', () => {
  it('opens an MR, marks commits QC Marked, and resyncs to stale on tip move', async () => {
    const path = '/auth/repos/mr-ns/study/merge-requests'
    const body = {
      sourceBranch: 'feature',
      targetBranch: 'main',
      expectedSourceHead: 'src1',
      expectedTargetHead: 'tgt1',
      commitIds: ['c-a', 'c-b'],
    }
    const headers = await regulatedMutationHeaders(manager, { method: 'POST', path, body })
    const created = await app.request(path, {
      method: 'POST',
      headers: { ...headers, cookie: await cookie() },
      body: JSON.stringify(body),
    })
    const createdJson = (await created.json()) as {
      mergeRequest?: { id: string; status: string }
      error?: string
    }
    assert.equal(created.status, 201, JSON.stringify(createdJson))
    assert.equal(createdJson.mergeRequest?.status, 'open')
    const mergeRequest = createdJson.mergeRequest!

    const qc = await app.request('/auth/repos/mr-ns/study/commits/c-a/qc', {
      headers: { cookie: await cookie() },
    })
    assert.equal(qc.status, 200)
    assert.equal(((await qc.json()) as { status: string }).status, 'marked')

    const resyncPath = `/auth/merge-requests/${mergeRequest.id}/resync`
    const resyncBody = { liveSourceHead: 'src1', liveTargetHead: 'tgt2' }
    const resyncHeaders = await regulatedMutationHeaders(manager, {
      method: 'POST',
      path: resyncPath,
      body: resyncBody,
    })
    const stale = await app.request(resyncPath, {
      method: 'POST',
      headers: { ...resyncHeaders, cookie: await cookie() },
      body: JSON.stringify(resyncBody),
    })
    const staleText = await stale.text()
    assert.equal(stale.status, 200, staleText)
    const staleJson = JSON.parse(staleText) as { mergeRequest?: { status: string } }
    assert.equal(staleJson.mergeRequest?.status, 'stale')
  })
})
