import '../../../db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { randomBytes } from 'node:crypto'
import { Hono } from 'hono'
import { isolatedAuth, regulatedMutationHeaders, sealedSessionCookie } from '../../src/packages/shared/lib/testSupport.js'

const t = isolatedAuth({ AUTHZ_BOOTSTRAP_ADMINS: 'root@x.io' })
after(() => t.restore())

const { createNamespaceAuthz } = await import('../../src/packages/authz/lib/authzNamespaceStore.js')
const { ensureRepository } = await import('../../src/packages/authz/lib/repositoryStore.js')
const { preparePrincipal } = await import('../../src/packages/authz/lib/authz.js')
const { registerMergeRequestRoutes } = await import('../../src/packages/merge/lib/mergeRequestRoutes.js')
const { openSignatureStore, useSignatureStore } = await import('../../src/packages/authentication/lib/signing/signatureStore.js')
const { immudbConfig, openLedger } = await import('../../src/packages/audit/lib/auditLedger.js')

useSignatureStore(
  openSignatureStore(
    await openLedger({ ...immudbConfig(), prefix: `mr-http/${randomBytes(4).toString('hex')}/` }),
  ),
)

const manager = t.person('manager')
await preparePrincipal(manager)
await t.grantRole(manager, 'manager')
assert.equal((await createNamespaceAuthz(manager, 'mr-ns', 'none')).ok, true)
const repo = await ensureRepository('mr-ns', 'study')
assert.ok(repo)
const { setRepoCollaborator } = await import('../../src/packages/authz/lib/authzCollaboratorStore.js')
const { grantApprover } = await import('../../src/packages/authz/lib/authzApproverStore.js')
await setRepoCollaborator('mr-ns', 'study', manager, 'maintain')
await grantApprover({ ns: 'mr-ns', repo: 'study' }, manager)

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

  it('rejects an open MR to rejected', async () => {
    const path = '/auth/repos/mr-ns/study/merge-requests'
    const body = {
      sourceBranch: 'reject-branch',
      targetBranch: 'main',
      expectedSourceHead: 'rsrc',
      expectedTargetHead: 'rtgt',
    }
    const headers = await regulatedMutationHeaders(manager, { method: 'POST', path, body })
    const created = await app.request(path, {
      method: 'POST',
      headers: { ...headers, cookie: await cookie() },
      body: JSON.stringify(body),
    })
    assert.equal(created.status, 201)
    const mr = ((await created.json()) as { mergeRequest: { id: string } }).mergeRequest

    const rejectPath = `/auth/merge-requests/${mr.id}/reject`
    const rejectHeaders = await regulatedMutationHeaders(manager, {
      method: 'POST',
      path: rejectPath,
      body: {},
    })
    const rejected = await app.request(rejectPath, {
      method: 'POST',
      headers: { ...rejectHeaders, cookie: await cookie() },
      body: JSON.stringify({}),
    })
    const rejectedJson = (await rejected.json()) as {
      mergeRequest?: { status: string }
      error?: string
    }
    assert.equal(rejected.status, 200, JSON.stringify(rejectedJson))
    assert.equal(rejectedJson.mergeRequest?.status, 'rejected')

    const dup = await app.request(path, {
      method: 'POST',
      headers: {
        ...(await regulatedMutationHeaders(manager, { method: 'POST', path, body })),
        cookie: await cookie(),
      },
      body: JSON.stringify(body),
    })
    assert.equal(dup.status, 409)
    assert.equal(((await dup.json()) as { code?: string }).code, 'already_open')

    const reopenPath = `/auth/merge-requests/${mr.id}/reopen`
    const reopenHeaders = await regulatedMutationHeaders(manager, {
      method: 'POST',
      path: reopenPath,
      body: { refreshExpected: true },
    })
    const reverted = await app.request(reopenPath, {
      method: 'POST',
      headers: { ...reopenHeaders, cookie: await cookie() },
      body: JSON.stringify({ refreshExpected: true }),
    })
    const revertedJson = (await reverted.json()) as {
      mergeRequest?: { status: string }
      error?: string
    }
    assert.equal(reverted.status, 200, JSON.stringify(revertedJson))
    assert.equal(revertedJson.mergeRequest?.status, 'open')
  })

  it('cancels an open MR to cancelled with write (no Approver required)', async () => {
    const writer = t.person('writer')
    await preparePrincipal(writer)
    await t.grantRole(writer, 'user')
    await setRepoCollaborator('mr-ns', 'study', writer, 'write')

    const path = '/auth/repos/mr-ns/study/merge-requests'
    const body = {
      sourceBranch: 'cancel-branch',
      targetBranch: 'main',
      expectedSourceHead: 'csrc',
      expectedTargetHead: 'ctgt',
    }
    const writerCookie = async () =>
      sealedSessionCookie({ ...writer, sessionStart: Math.floor(Date.now() / 1000) })
    const headers = await regulatedMutationHeaders(writer, { method: 'POST', path, body })
    const created = await app.request(path, {
      method: 'POST',
      headers: { ...headers, cookie: await writerCookie() },
      body: JSON.stringify(body),
    })
    assert.equal(created.status, 201, await created.clone().text())
    const mr = ((await created.json()) as { mergeRequest: { id: string } }).mergeRequest

    const cancelPath = `/auth/merge-requests/${mr.id}/cancel`
    const cancelHeaders = await regulatedMutationHeaders(writer, {
      method: 'POST',
      path: cancelPath,
      body: {},
    })
    const cancelled = await app.request(cancelPath, {
      method: 'POST',
      headers: { ...cancelHeaders, cookie: await writerCookie() },
      body: JSON.stringify({}),
    })
    const cancelledJson = (await cancelled.json()) as {
      mergeRequest?: { status: string }
      error?: string
    }
    assert.equal(cancelled.status, 200, JSON.stringify(cancelledJson))
    assert.equal(cancelledJson.mergeRequest?.status, 'cancelled')

    const rejectPath = `/auth/merge-requests/${mr.id}/reject`
    const rejectHeaders = await regulatedMutationHeaders(writer, {
      method: 'POST',
      path: rejectPath,
      body: {},
    })
    const rejectDenied = await app.request(rejectPath, {
      method: 'POST',
      headers: { ...rejectHeaders, cookie: await writerCookie() },
      body: JSON.stringify({}),
    })
    assert.equal(rejectDenied.status, 403)

    const reopenPath = `/auth/merge-requests/${mr.id}/reopen`
    const reopenHeaders = await regulatedMutationHeaders(writer, {
      method: 'POST',
      path: reopenPath,
      body: { refreshExpected: true },
    })
    const reopened = await app.request(reopenPath, {
      method: 'POST',
      headers: { ...reopenHeaders, cookie: await writerCookie() },
      body: JSON.stringify({ refreshExpected: true }),
    })
    const reopenedJson = (await reopened.json()) as {
      mergeRequest?: { status: string }
      error?: string
    }
    assert.equal(reopened.status, 200, JSON.stringify(reopenedJson))
    assert.equal(reopenedJson.mergeRequest?.status, 'open')
  })
})
