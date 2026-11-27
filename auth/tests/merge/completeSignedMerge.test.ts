import '../../src/db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { randomBytes } from 'node:crypto'
import { Hono } from 'hono'
import { isolatedAuth, sealedSessionCookie } from '../../src/packages/shared/lib/testSupport.js'

const t = isolatedAuth({ AUTHZ_BOOTSTRAP_ADMINS: 'root@x.io' })
after(() => t.restore())

const { createNamespaceAuthz } = await import('../../src/packages/authz/lib/authzNamespaceStore.js')
const { ensureRepository } = await import('../../src/packages/authz/lib/repositoryStore.js')
const { preparePrincipal } = await import('../../src/packages/authz/lib/authz.js')
const { grantApprover } = await import('../../src/packages/authz/lib/authzApproverStore.js')
const { openMergeRequest } = await import('../../src/packages/merge/lib/mergeRequestStore.js')
const { getCommitQc, markCommitsQc } = await import('../../src/packages/merge/lib/commitQcStore.js')
const {
  registerMergeRequestRoutes,
  setMergeExecutorForTests,
  setMergeManifestResolverForTests,
  setMergeRangeResolverForTests,
  setLiveHeadsResolverForTests,
} = await import('../../src/packages/merge/lib/mergeRequestRoutes.js')
const { openSignatureStore, useSignatureStore } = await import('../../src/packages/authentication/lib/signing/signatureStore.js')
const { buildMergeManifest, mergeResultBinding } = await import('../../src/packages/authentication/lib/signing/mergeManifest.js')
const { immudbConfig, openLedger } = await import('../../src/packages/audit/lib/auditLedger.js')
const { recordRestoreTestPassed, resetRestoreTestGate } = await import('../../src/packages/platform/lib/restoreTestGate.js')
const { signerAuthorKey } = await import('../../src/packages/merge/lib/selfMerge.js')

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
  setMergeRangeResolverForTests(async () => ({
    authors,
    commitIds,
    authorsByCommitId: Object.fromEntries(commitIds.map((id) => [id, [...authors]])),
  }))
}

function dispositionBody(commitIds: string[], mergeCommitDisposition: 'valid' | 'invalid' = 'valid') {
  return {
    disposition: Object.fromEntries(commitIds.map((id) => [id, 'valid' as const])),
    mergeCommitDisposition,
  }
}

describe('complete signed merge (gxp/05 HTTP)', () => {
  it('completes an open MR with a bound Approved signature and disposition map', async () => {
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
    const { signatureStore } = await import('../../src/packages/authentication/lib/signing/signatureStore.js')
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
        ...dispositionBody(['c1', 'c2']),
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
    assert.equal(await getCommitQc(repo.id, 'c1'), 'valid')
    assert.equal(await getCommitQc(repo.id, 'merge-sha-1'), 'valid')
  })

  it('refuses when disposition would Valid the signer\'s own Unset commit', async () => {
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
    const { signatureStore } = await import('../../src/packages/authentication/lib/signing/signatureStore.js')
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
        'x-mice-reason': 'Self-Valid disposition attempt should be refused',
      },
      body: JSON.stringify({
        authors: [],
        commitIds: [],
        signatureId: id,
        disposition: { 'c-self': 'valid' },
        mergeCommitDisposition: 'valid',
      }),
    })
    const json = (await res.json()) as { code?: string }
    assert.equal(res.status, 403, JSON.stringify(json))
    assert.equal(json.code, 'self_valid')
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
    const { signatureStore } = await import('../../src/packages/authentication/lib/signing/signatureStore.js')
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
    const { signatureStore } = await import('../../src/packages/authentication/lib/signing/signatureStore.js')
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
    const { signatureStore } = await import('../../src/packages/authentication/lib/signing/signatureStore.js')
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
    const { signatureStore } = await import('../../src/packages/authentication/lib/signing/signatureStore.js')
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
      body: JSON.stringify({ signatureId: id, disposition: { 'c-fail': 'valid' }, mergeCommitDisposition: 'valid' }),
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
    const { signatureStore } = await import('../../src/packages/authentication/lib/signing/signatureStore.js')
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

  it('completes with mixed Valid/Invalid disposition (Invalid soft)', async () => {
    setMergeExecutorForTests(async () => ({ mergeCommitId: 'merge-mixed' }))
    const mr = await openMergeRequest({
      repositoryId: repo.id,
      namespace: 'gxp5',
      repo: 'assay',
      sourceBranch: 'feature-mixed',
      targetBranch: 'main',
      expectedSourceHead: 'src-mx',
      expectedTargetHead: 'tgt-mx',
      openedBy: { iss: requester.iss, sub: requester.sub },
    })
    await markCommitsQc(repo.id, ['c-already-invalid'], 'invalid')
    const merge = buildMergeManifest([])
    const { binding, manifest } = mergeResultBinding({
      repo: 'gxp5/assay',
      sourceHead: 'src-mx',
      targetHead: 'tgt-mx',
      merge,
    })
    setMergeManifestResolverForTests(async () => merge)
    pinHeads('src-mx', 'tgt-mx')
    pinRange(['https://other|scientist'], ['c-mx', 'c-already-invalid'])
    const { signatureStore } = await import('../../src/packages/authentication/lib/signing/signatureStore.js')
    const store = await signatureStore()
    const { id } = await store.record({
      signer: { iss: approver.iss, sub: approver.sub, name: approver.name },
      meaning: 'Approved',
      contentHash: binding.manifestDigest,
      binding,
      manifest,
      changeControlId: 'CC-mx',
    })
    const res = await app.request(`/auth/merge-requests/${mr.id}/complete`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: await cookie(),
        'x-mice-reason': 'Merge with mixed Valid and Invalid disposition',
      },
      body: JSON.stringify({
        signatureId: id,
        disposition: { 'c-mx': 'valid', 'c-already-invalid': 'invalid' },
        mergeCommitDisposition: 'valid',
      }),
    })
    const json = (await res.json()) as { code?: string; error?: string; mergeCommitId?: string }
    assert.equal(res.status, 200, JSON.stringify(json))
    assert.equal(await getCommitQc(repo.id, 'c-mx'), 'valid')
    assert.equal(await getCommitQc(repo.id, 'c-already-invalid'), 'invalid')
    assert.equal(await getCommitQc(repo.id, 'merge-mixed'), 'valid')
    setMergeExecutorForTests(async () => ({ mergeCommitId: 'merge-sha-1' }))
  })

  it('allows Invalid on the signer\'s own Unset commit', async () => {
    setMergeExecutorForTests(async () => ({ mergeCommitId: 'merge-self-inv' }))
    const mr = await openMergeRequest({
      repositoryId: repo.id,
      namespace: 'gxp5',
      repo: 'assay',
      sourceBranch: 'feature-self-inv',
      targetBranch: 'main',
      expectedSourceHead: 'src-si',
      expectedTargetHead: 'tgt-si',
      openedBy: { iss: requester.iss, sub: requester.sub },
    })
    const merge = buildMergeManifest([])
    const { binding, manifest } = mergeResultBinding({
      repo: 'gxp5/assay',
      sourceHead: 'src-si',
      targetHead: 'tgt-si',
      merge,
    })
    setMergeManifestResolverForTests(async () => merge)
    pinHeads('src-si', 'tgt-si')
    pinRange([signerAuthorKey(approver)], ['c-si'])
    const { signatureStore } = await import('../../src/packages/authentication/lib/signing/signatureStore.js')
    const { id } = await (
      await signatureStore()
    ).record({
      signer: { iss: approver.iss, sub: approver.sub, name: approver.name },
      meaning: 'Approved',
      contentHash: binding.manifestDigest,
      binding,
      manifest,
      changeControlId: 'CC-si',
    })
    const res = await app.request(`/auth/merge-requests/${mr.id}/complete`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: await cookie(),
        'x-mice-reason': 'Approver Invalids their own Unset commit',
      },
      body: JSON.stringify({
        signatureId: id,
        disposition: { 'c-si': 'invalid' },
        mergeCommitDisposition: 'valid',
      }),
    })
    const json = (await res.json()) as { code?: string; error?: string }
    assert.equal(res.status, 200, JSON.stringify(json))
    assert.equal(await getCommitQc(repo.id, 'c-si'), 'invalid')
    setMergeExecutorForTests(async () => ({ mergeCommitId: 'merge-sha-1' }))
  })
})
