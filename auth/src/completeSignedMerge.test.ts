import './db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { randomBytes } from 'node:crypto'
import { Hono } from 'hono'
import { isolatedAuth, sealedSessionCookie } from './testSupport.js'

const t = isolatedAuth({ AUTHZ_BOOTSTRAP_ADMINS: 'root@x.io' })
after(() => t.restore())

const { createNamespaceAuthz } = await import('./authzNamespaceStore.js')
const { ensureRepository } = await import('./repositoryStore.js')
const { preparePrincipal } = await import('./authz.js')
const { grantApprover } = await import('./authzApproverStore.js')
const { openMergeRequest } = await import('./mergeRequestStore.js')
const { getCommitQc } = await import('./commitQcStore.js')
const { registerMergeRequestRoutes, setMergeExecutorForTests } = await import('./mergeRequestRoutes.js')
const { openSignatureStore, useSignatureStore } = await import('./authentication/signing/signatureStore.js')
const { buildMergeManifest, mergeResultBinding } = await import('./authentication/signing/mergeManifest.js')
const { immudbConfig, openLedger } = await import('./auditLedger.js')
const { recordRestoreTestPassed, resetRestoreTestGate } = await import('./restoreTestGate.js')

useSignatureStore(
  openSignatureStore(
    await openLedger({ ...immudbConfig(), prefix: `gxp05/${randomBytes(4).toString('hex')}/` }),
  ),
)
resetRestoreTestGate()
await recordRestoreTestPassed({ recordedBy: 'test' })

const approver = t.person('approver')
await preparePrincipal(approver)
await t.grantRole(approver, 'manager')
assert.equal((await createNamespaceAuthz(approver, 'gxp5', 'none')).ok, true)
const repo = await ensureRepository('gxp5', 'assay')
assert.ok(repo)
await grantApprover({ ns: 'gxp5', repo: 'assay' }, approver)

const app = new Hono()
registerMergeRequestRoutes(app, { audit: async () => {} })
setMergeExecutorForTests(async () => ({ mergeCommitId: 'merge-sha-1' }))
after(() => setMergeExecutorForTests(null))

const cookie = async () =>
  sealedSessionCookie({ ...approver, sessionStart: Math.floor(Date.now() / 1000) })

describe('complete signed merge (gxp/05 HTTP)', () => {
  it('completes an open MR with a bound Approved signature and marks QC Passed', async () => {
    const mr = await openMergeRequest({
      repositoryId: repo.id,
      namespace: 'gxp5',
      repo: 'assay',
      sourceBranch: 'feature',
      targetBranch: 'main',
      expectedSourceHead: 'src-head',
      expectedTargetHead: 'tgt-head',
      openedBy: { iss: approver.iss, sub: approver.sub },
    })

    const entries = [{ path: 'a.txt', contentHash: 'aa'.repeat(32) }]
    const merge = buildMergeManifest(entries)
    const { binding, manifest } = mergeResultBinding({
      repo: 'gxp5/assay',
      sourceHead: 'src-head',
      targetHead: 'tgt-head',
      merge,
    })
    const { signatureStore } = await import('./authentication/signing/signatureStore.js')
    const { id } = await (
      await signatureStore()
    ).record({
      signer: { iss: approver.iss, sub: approver.sub, name: approver.name },
      meaning: 'Approved',
      contentHash: binding.manifestDigest,
      binding,
      manifest,
      changeControlId: 'CC-20261116-gxp5',
    })

    const path = `/auth/merge-requests/${mr.id}/complete`
    const body = {
      liveSourceHead: 'src-head',
      liveTargetHead: 'tgt-head',
      authors: ['https://other|scientist'],
      commitIds: ['c1', 'c2'],
      signatureId: id,
      manifestEntries: entries,
    }
    const res = await app.request(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: await cookie(),
        'x-mice-reason': 'Approved merge of assay feature into main',
        'x-mice-reason-category': 'other',
      },
      body: JSON.stringify(body),
    })
    const json = (await res.json()) as {
      mergeRequest?: { status: string; mergeCommitId?: string | null }
      mergeCommitId?: string
      error?: string
      code?: string
    }
    assert.equal(res.status, 200, JSON.stringify(json))
    assert.equal(json.mergeRequest?.status, 'merged')
    assert.equal(json.mergeCommitId, 'merge-sha-1')
    assert.equal(await getCommitQc(repo.id, 'c1'), 'passed')
    assert.equal(await getCommitQc(repo.id, 'merge-sha-1'), 'passed')
  })

  it('GXP-R-063 refuses complete until a restore test has passed', async () => {
    resetRestoreTestGate()
    const mr = await openMergeRequest({
      repositoryId: repo.id,
      namespace: 'gxp5',
      repo: 'assay',
      sourceBranch: 'feature-r',
      targetBranch: 'main',
      expectedSourceHead: 'src-r',
      expectedTargetHead: 'tgt-r',
      openedBy: { iss: approver.iss, sub: approver.sub },
    })
    const merge = buildMergeManifest([])
    const { binding, manifest } = mergeResultBinding({
      repo: 'gxp5/assay',
      sourceHead: 'src-r',
      targetHead: 'tgt-r',
      merge,
    })
    const { signatureStore } = await import('./authentication/signing/signatureStore.js')
    const { id } = await (
      await signatureStore()
    ).record({
      signer: { iss: approver.iss, sub: approver.sub, name: approver.name },
      meaning: 'Approved',
      contentHash: binding.manifestDigest,
      binding,
      manifest,
      changeControlId: 'CC-restore',
    })
    const res = await app.request(`/auth/merge-requests/${mr.id}/complete`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: await cookie(),
        'x-mice-reason': 'Attempt merge before restore test',
        'x-mice-reason-category': 'other',
      },
      body: JSON.stringify({
        liveSourceHead: 'src-r',
        liveTargetHead: 'tgt-r',
        authors: ['https://other|scientist'],
        signatureId: id,
        manifestEntries: [],
      }),
    })
    const json = (await res.json()) as { code?: string; error?: string }
    assert.equal(res.status, 503)
    assert.equal(json.code, 'restore_test_required')
    await recordRestoreTestPassed({ recordedBy: 'test' })
  })

  it('refuses when the signer is not an approver', async () => {
    const writer = t.person('writer')
    await preparePrincipal(writer)
    await t.grantRole(writer, 'user')
    // writer is namespace member via create? need write on repo — use manager without approver
    const other = t.person('notapprover')
    await preparePrincipal(other)
    await t.grantRole(other, 'manager')

    const mr = await openMergeRequest({
      repositoryId: repo.id,
      namespace: 'gxp5',
      repo: 'assay',
      sourceBranch: 'f2',
      targetBranch: 'main',
      expectedSourceHead: 's2',
      expectedTargetHead: 't2',
      openedBy: { iss: other.iss, sub: other.sub },
    })
    const merge = buildMergeManifest([])
    const { binding, manifest } = mergeResultBinding({
      repo: 'gxp5/assay',
      sourceHead: 's2',
      targetHead: 't2',
      merge,
    })
    const { signatureStore } = await import('./authentication/signing/signatureStore.js')
    const { id } = await (
      await signatureStore()
    ).record({
      signer: { iss: other.iss, sub: other.sub, name: other.name },
      meaning: 'Approved',
      contentHash: binding.manifestDigest,
      binding,
      manifest,
      changeControlId: 'CC-2',
    })

    const res = await app.request(`/auth/merge-requests/${mr.id}/complete`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: await sealedSessionCookie({ ...other, sessionStart: Math.floor(Date.now() / 1000) }),
        'x-mice-reason': 'Attempted merge without approver role',
        'x-mice-reason-category': 'other',
      },
      body: JSON.stringify({
        liveSourceHead: 's2',
        liveTargetHead: 't2',
        authors: ['https://idp|x'],
        signatureId: id,
        manifestEntries: [],
      }),
    })
    const json = (await res.json()) as { code?: string }
    assert.equal(res.status, 403)
    assert.equal(json.code, 'not_approver')
  })
})
