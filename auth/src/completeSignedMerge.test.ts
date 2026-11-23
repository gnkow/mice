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
const {
  registerMergeRequestRoutes,
  setMergeExecutorForTests,
  setMergeManifestResolverForTests,
  setMergeRangeResolverForTests,
  setLiveHeadsResolverForTests,
} = await import('./mergeRequestRoutes.js')
const { openSignatureStore, useSignatureStore } = await import('./authentication/signing/signatureStore.js')
const { buildMergeManifest, mergeResultBinding } = await import('./authentication/signing/mergeManifest.js')
const { immudbConfig, openLedger } = await import('./auditLedger.js')
const { recordRestoreTestPassed, resetRestoreTestGate } = await import('./restoreTestGate.js')
const { signerAuthorKey } = await import('./selfMerge.js')

useSignatureStore(
  openSignatureStore(
    await openLedger({ ...immudbConfig(), prefix: `gxp05/${randomBytes(4).toString('hex')}/` }),
  ),
)
resetRestoreTestGate()
await recordRestoreTestPassed({ recordedBy: 'test' })

const approver = t.person('approver')
const requester = t.person('requester')
await preparePrincipal(approver)
await preparePrincipal(requester)
await t.grantRole(approver, 'manager')
await t.grantRole(requester, 'user')
assert.equal((await createNamespaceAuthz(approver, 'gxp5', 'none')).ok, true)
const repo = await ensureRepository('gxp5', 'assay')
assert.ok(repo)
await grantApprover({ ns: 'gxp5', repo: 'assay' }, approver)

const app = new Hono()
registerMergeRequestRoutes(app, { audit: async () => {} })
setMergeExecutorForTests(async () => ({ mergeCommitId: 'merge-sha-1' }))
after(() => {
  setMergeExecutorForTests(null)
  setMergeManifestResolverForTests(null)
  setMergeRangeResolverForTests(null)
  setLiveHeadsResolverForTests(null)
})

const cookie = async () =>
  sealedSessionCookie({ ...approver, sessionStart: Math.floor(Date.now() / 1000) })

function pinHeads(sourceHead: string, targetHead: string) {
  setLiveHeadsResolverForTests(async () => ({ sourceHead, targetHead }))
}

function pinRange(authors: string[], commitIds: string[]) {
  setMergeRangeResolverForTests(async () => ({ authors, commitIds }))
}

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
      openedBy: { iss: requester.iss, sub: requester.sub },
    })

    const entries = [{ path: 'a.txt', contentHash: 'aa'.repeat(32) }]
    const merge = buildMergeManifest(entries)
    const { binding, manifest } = mergeResultBinding({
      repo: 'gxp5/assay',
      sourceHead: 'src-head',
      targetHead: 'tgt-head',
      merge,
    })
    setMergeManifestResolverForTests(async () => merge)
    pinHeads('src-head', 'tgt-head')
    pinRange(['https://other|scientist'], ['c1', 'c2'])
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
    const res = await app.request(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: await cookie(),
        'x-mice-reason': 'Approved merge of assay feature into main',
      },
      body: JSON.stringify({
        // Client-supplied authors/heads must be ignored.
        liveSourceHead: 'forged',
        liveTargetHead: 'forged',
        authors: [],
        commitIds: [],
        signatureId: id,
      }),
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

  it('refuses self-merge using server-derived authors, ignoring body authors', async () => {
    let executed = 0
    setMergeExecutorForTests(async () => {
      executed += 1
      return { mergeCommitId: 'should-not-run' }
    })
    const mr = await openMergeRequest({
      repositoryId: repo.id,
      namespace: 'gxp5',
      repo: 'assay',
      sourceBranch: 'feature-self',
      targetBranch: 'main',
      expectedSourceHead: 'src-self',
      expectedTargetHead: 'tgt-self',
      openedBy: { iss: requester.iss, sub: requester.sub },
    })
    const merge = buildMergeManifest([])
    const { binding, manifest } = mergeResultBinding({
      repo: 'gxp5/assay',
      sourceHead: 'src-self',
      targetHead: 'tgt-self',
      merge,
    })
    setMergeManifestResolverForTests(async () => merge)
    pinHeads('src-self', 'tgt-self')
    pinRange([signerAuthorKey(approver)], ['c-self'])
    const { signatureStore } = await import('./authentication/signing/signatureStore.js')
    const store = await signatureStore()
    const { id } = await store.record({
      signer: { iss: approver.iss, sub: approver.sub, name: approver.name },
      meaning: 'Approved',
      contentHash: binding.manifestDigest,
      binding,
      manifest,
      changeControlId: 'CC-self',
    })
    const res = await app.request(`/auth/merge-requests/${mr.id}/complete`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: await cookie(),
        'x-mice-reason': 'Self-merge attempt should be refused',
      },
      body: JSON.stringify({
        authors: [],
        commitIds: [],
        signatureId: id,
      }),
    })
    const json = (await res.json()) as { code?: string }
    assert.equal(res.status, 403, JSON.stringify(json))
    assert.equal(json.code, 'self_merge')
    assert.equal(executed, 0)
    assert.equal(await store.isConsumed(id), false)
    setMergeExecutorForTests(async () => ({ mergeCommitId: 'merge-sha-1' }))
  })

  it('refuses when the signature was created by a different principal', async () => {
    const mr = await openMergeRequest({
      repositoryId: repo.id,
      namespace: 'gxp5',
      repo: 'assay',
      sourceBranch: 'feature-steal',
      targetBranch: 'main',
      expectedSourceHead: 'src-steal',
      expectedTargetHead: 'tgt-steal',
      openedBy: { iss: requester.iss, sub: requester.sub },
    })
    const merge = buildMergeManifest([])
    const { binding, manifest } = mergeResultBinding({
      repo: 'gxp5/assay',
      sourceHead: 'src-steal',
      targetHead: 'tgt-steal',
      merge,
    })
    setMergeManifestResolverForTests(async () => merge)
    pinHeads('src-steal', 'tgt-steal')
    pinRange(['https://other|scientist'], ['c-steal'])
    const { signatureStore } = await import('./authentication/signing/signatureStore.js')
    const { id } = await (
      await signatureStore()
    ).record({
      signer: { iss: requester.iss, sub: requester.sub, name: requester.name },
      meaning: 'Approved',
      contentHash: binding.manifestDigest,
      binding,
      manifest,
      changeControlId: 'CC-steal',
    })
    const res = await app.request(`/auth/merge-requests/${mr.id}/complete`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: await cookie(),
        'x-mice-reason': 'Consume someone else signature',
      },
      body: JSON.stringify({ signatureId: id }),
    })
    const json = (await res.json()) as { code?: string; error?: string }
    assert.equal(res.status, 400, JSON.stringify(json))
    assert.equal(json.code, 'signature_invalid')
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
      openedBy: { iss: requester.iss, sub: requester.sub },
    })
    const merge = buildMergeManifest([])
    const { binding, manifest } = mergeResultBinding({
      repo: 'gxp5/assay',
      sourceHead: 'src-r',
      targetHead: 'tgt-r',
      merge,
    })
    setMergeManifestResolverForTests(async () => merge)
    pinHeads('src-r', 'tgt-r')
    pinRange(['https://other|scientist'], ['c-r'])
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
      },
      body: JSON.stringify({ signatureId: id }),
    })
    const json = (await res.json()) as { code?: string; error?: string }
    assert.equal(res.status, 503)
    assert.equal(json.code, 'restore_test_required')
    await recordRestoreTestPassed({ recordedBy: 'test' })
  })

  it('refuses when live tips moved since the MR expected heads', async () => {
    let executed = 0
    setMergeExecutorForTests(async () => {
      executed += 1
      return { mergeCommitId: 'should-not-run' }
    })
    const mr = await openMergeRequest({
      repositoryId: repo.id,
      namespace: 'gxp5',
      repo: 'assay',
      sourceBranch: 'feature-moved',
      targetBranch: 'main',
      expectedSourceHead: 'src-expected',
      expectedTargetHead: 'tgt-expected',
      openedBy: { iss: requester.iss, sub: requester.sub },
    })
    const merge = buildMergeManifest([])
    const { binding, manifest } = mergeResultBinding({
      repo: 'gxp5/assay',
      sourceHead: 'src-expected',
      targetHead: 'tgt-expected',
      merge,
    })
    setMergeManifestResolverForTests(async () => merge)
    // Server sees moved tips — body cannot override.
    pinHeads('src-moved', 'tgt-moved')
    pinRange(['https://other|scientist'], ['c-moved'])
    const { signatureStore } = await import('./authentication/signing/signatureStore.js')
    const store = await signatureStore()
    const { id } = await store.record({
      signer: { iss: approver.iss, sub: approver.sub, name: approver.name },
      meaning: 'Approved',
      contentHash: binding.manifestDigest,
      binding,
      manifest,
      changeControlId: 'CC-moved',
    })
    const res = await app.request(`/auth/merge-requests/${mr.id}/complete`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: await cookie(),
        'x-mice-reason': 'Attempt merge after tip moved',
      },
      body: JSON.stringify({
        liveSourceHead: 'src-expected',
        liveTargetHead: 'tgt-expected',
        signatureId: id,
      }),
    })
    const json = (await res.json()) as { code?: string }
    assert.equal(res.status, 409, JSON.stringify(json))
    assert.equal(json.code, 'head_mismatch')
    assert.equal(executed, 0)
    assert.equal(await store.isConsumed(id), false)
    setMergeExecutorForTests(async () => ({ mergeCommitId: 'merge-sha-1' }))
  })

  it('returns merge_failed and leaves the signature consumed when oxen merge throws', async () => {
    setMergeExecutorForTests(async () => {
      throw new Error('oxen conflict')
    })
    const mr = await openMergeRequest({
      repositoryId: repo.id,
      namespace: 'gxp5',
      repo: 'assay',
      sourceBranch: 'feature-fail',
      targetBranch: 'main',
      expectedSourceHead: 'src-fail',
      expectedTargetHead: 'tgt-fail',
      openedBy: { iss: requester.iss, sub: requester.sub },
    })
    const merge = buildMergeManifest([])
    const { binding, manifest } = mergeResultBinding({
      repo: 'gxp5/assay',
      sourceHead: 'src-fail',
      targetHead: 'tgt-fail',
      merge,
    })
    setMergeManifestResolverForTests(async () => merge)
    pinHeads('src-fail', 'tgt-fail')
    pinRange(['https://other|scientist'], ['c-fail'])
    const { signatureStore } = await import('./authentication/signing/signatureStore.js')
    const store = await signatureStore()
    const { id } = await store.record({
      signer: { iss: approver.iss, sub: approver.sub, name: approver.name },
      meaning: 'Approved',
      contentHash: binding.manifestDigest,
      binding,
      manifest,
      changeControlId: 'CC-fail',
    })
    const res = await app.request(`/auth/merge-requests/${mr.id}/complete`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: await cookie(),
        'x-mice-reason': 'Merge will fail after consume',
      },
      body: JSON.stringify({ signatureId: id }),
    })
    const json = (await res.json()) as { code?: string; error?: string }
    assert.equal(res.status, 502, JSON.stringify(json))
    assert.equal(json.code, 'merge_failed')
    assert.match(json.error ?? '', /consumed/i)
    assert.equal(await store.isConsumed(id), true)
    setMergeExecutorForTests(async () => ({ mergeCommitId: 'merge-sha-1' }))
  })

  it('refuses when the signer is not an approver', async () => {
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
    setMergeManifestResolverForTests(async () => merge)
    pinHeads('s2', 't2')
    pinRange(['https://idp|x'], ['c2'])
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
      },
      body: JSON.stringify({ signatureId: id }),
    })
    const json = (await res.json()) as { code?: string }
    assert.equal(res.status, 403)
    assert.equal(json.code, 'not_approver')
  })
})
