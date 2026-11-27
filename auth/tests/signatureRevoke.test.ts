import '../src/db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { randomBytes } from 'node:crypto'
import { isolatedAuth } from '../src/packages/shared/lib/testSupport.js'

const t = isolatedAuth({ AUTHZ_BOOTSTRAP_ADMINS: 'root@x.io' })
after(() => t.restore())

const { createNamespaceAuthz } = await import('../src/packages/authz/lib/authzNamespaceStore.js')
const { ensureRepository } = await import('../src/packages/authz/lib/repositoryStore.js')
const { preparePrincipal } = await import('../src/packages/authz/lib/authz.js')
const { grantApprover } = await import('../src/packages/authz/lib/authzApproverStore.js')
const { openMergeRequest, getMergeRequest } = await import('../src/packages/merge/lib/mergeRequestStore.js')
const { getCommitQc, markCommitsQc } = await import('../src/packages/merge/lib/commitQcStore.js')
const { revokeSignature, revertSignatureRevocation } = await import('../src/packages/merge/lib/signatureRevoke.js')
const { openSignatureStore, useSignatureStore } = await import('../src/packages/authentication/lib/signing/signatureStore.js')
const { buildMergeManifest, mergeResultBinding } = await import('../src/packages/authentication/lib/signing/mergeManifest.js')
const { immudbConfig, openLedger } = await import('../src/packages/audit/lib/auditLedger.js')

useSignatureStore(
  openSignatureStore(
    await openLedger({ ...immudbConfig(), prefix: `revoke/${randomBytes(4).toString('hex')}/` }),
  ),
)

const approver = t.person('revoker')
await preparePrincipal(approver)
await t.grantRole(approver, 'manager')
assert.equal((await createNamespaceAuthz(approver, 'rev-ns', 'none')).ok, true)
const repo = await ensureRepository('rev-ns', 'data')
assert.ok(repo)
await grantApprover({ ns: 'rev-ns', repo: 'data' }, approver)

let sigCcSeq = 0
async function recordBoundSignature(heads: { source: string; target: string }) {
  const merge = buildMergeManifest([])
  const { binding, manifest } = mergeResultBinding({
    repo: 'rev-ns/data',
    sourceHead: heads.source,
    targetHead: heads.target,
    merge,
  })
  const { signatureStore } = await import('../src/packages/authentication/lib/signing/signatureStore.js')
  sigCcSeq += 1
  return (
    await signatureStore()
  ).record({
    signer: { iss: approver.iss, sub: approver.sub, name: approver.name },
    meaning: 'Approved',
    contentHash: binding.manifestDigest,
    binding,
    manifest,
    changeControlId: `CC-REV-SIG-${sigCcSeq}`,
  })
}

describe('signature revoke (gxp/07/08/09)', () => {
  it('writes a linked revocation without flipping QC, and keeps the original signature', async () => {
    const { id } = await recordBoundSignature({ source: 's1', target: 't1' })
    await markCommitsQc(repo.id, ['s1', 'c-range'], 'valid')

    const notified: Array<{ summary: string; recipients?: unknown }> = []
    const result = await revokeSignature({
      signatureId: id,
      revoker: approver,
      reason: 'QC failure on assay batch',
      changeControlId: 'CC-REV-2',
      commitIds: ['s1', 'c-range'],
      notify: async (event) => {
        notified.push({ summary: event.summary, recipients: event.recipients })
      },
    })
    assert.equal(result.ok, true)
    if (!result.ok) return

    const { signatureStore } = await import('../src/packages/authentication/lib/signing/signatureStore.js')
    const store = await signatureStore()
    assert.ok(await store.get(id), 'original signature must remain')
    const revs = await store.listRevocations(id)
    assert.equal(revs.length, 1)
    assert.equal(revs[0]?.reason, 'QC failure on assay batch')
    assert.equal(await getCommitQc(repo.id, 's1'), 'valid')
    assert.equal(await getCommitQc(repo.id, 'c-range'), 'valid')
    assert.ok(notified.length >= 1)
    assert.match(notified[0]!.summary, /revoked/i)
  })

  it('blocks an open merge request when revoked commits match expected heads', async () => {
    const { id } = await recordBoundSignature({ source: 'src-open', target: 'tgt-open' })
    const mr = await openMergeRequest({
      repositoryId: repo.id,
      namespace: 'rev-ns',
      repo: 'data',
      sourceBranch: 'feature',
      targetBranch: 'main',
      expectedSourceHead: 'src-open',
      expectedTargetHead: 'tgt-open',
      openedBy: approver,
    })
    const result = await revokeSignature({
      signatureId: id,
      revoker: approver,
      reason: 'Revoke before merge to block the request',
      changeControlId: 'CC-REV-3',
      commitIds: ['src-open'],
      notify: async () => {},
    })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.ok(result.blockedMergeRequestIds.includes(mr.id))
    assert.equal((await getMergeRequest(mr.id))?.status, 'rejected')
  })

  it('whole-signature revoke resolves merge-range commit ids without flipping QC', async () => {
    const { markMergeRequestMerged } = await import('../src/packages/merge/index.js')
    const { id } = await recordBoundSignature({ source: 'src-ws', target: 'tgt-ws' })
    const mr = await openMergeRequest({
      repositoryId: repo.id,
      namespace: 'rev-ns',
      repo: 'data',
      sourceBranch: 'feature-ws',
      targetBranch: 'main',
      expectedSourceHead: 'src-ws',
      expectedTargetHead: 'tgt-ws',
      openedBy: approver,
    })
    await markMergeRequestMerged(mr.id, { mergeCommitId: 'merge-ws' })
    await markCommitsQc(repo.id, ['src-ws', 'c-mid', 'merge-ws'], 'valid', {
      mergeRequestId: mr.id,
    })
    const result = await revokeSignature({
      signatureId: id,
      revoker: approver,
      reason: 'Whole-signature revoke after merged assay',
      changeControlId: 'CC-REV-WS',
      notify: async () => {},
    })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.deepEqual(new Set(result.revocation.commitIds), new Set(['src-ws', 'c-mid', 'merge-ws']))
    assert.equal(await getCommitQc(repo.id, 'c-mid'), 'valid')
    assert.equal(await getCommitQc(repo.id, 'merge-ws'), 'valid')
    // Pre-merge target tip is not "incoming".
    assert.equal(await getCommitQc(repo.id, 'tgt-ws'), 'unset')
  })

  it('whole-signature revoke with mergeRequestId fails incoming tip + merge, not target tip', async () => {
    const { markMergeRequestMerged } = await import('../src/packages/merge/index.js')
    const { id } = await recordBoundSignature({ source: 'src-mr', target: 'tgt-mr' })
    const mr = await openMergeRequest({
      repositoryId: repo.id,
      namespace: 'rev-ns',
      repo: 'data',
      sourceBranch: 'feature-mr',
      targetBranch: 'main',
      expectedSourceHead: 'src-mr',
      expectedTargetHead: 'tgt-mr',
      openedBy: approver,
    })
    await markMergeRequestMerged(mr.id, { mergeCommitId: 'merge-mr' })
    await markCommitsQc(repo.id, ['src-mr', 'c-in', 'merge-mr'], 'valid', {
      mergeRequestId: mr.id,
    })
    const result = await revokeSignature({
      signatureId: id,
      revoker: approver,
      reason: 'Whole revoke via mergeRequestId',
      changeControlId: 'CC-REV-MRID',
      mergeRequestId: mr.id,
      notify: async () => {},
    })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(await getCommitQc(repo.id, 'src-mr'), 'valid')
    assert.equal(await getCommitQc(repo.id, 'c-in'), 'valid')
    assert.equal(await getCommitQc(repo.id, 'merge-mr'), 'valid')
    assert.ok(!result.revocation.commitIds.includes('tgt-mr'))
    assert.equal(await getCommitQc(repo.id, 'tgt-mr'), 'unset')
  })

  it('partial revoke lists only requested commits and does not flip QC', async () => {
    const { id } = await recordBoundSignature({ source: 'only-a', target: 'tgt-x' })
    await markCommitsQc(repo.id, ['only-a', 'sibling'], 'valid')
    const result = await revokeSignature({
      signatureId: id,
      revoker: approver,
      reason: 'Revoke one commit only',
      changeControlId: 'CC-REV-4',
      commitIds: ['only-a'],
      notify: async () => {},
    })
    assert.equal(result.ok, true)
    assert.equal(await getCommitQc(repo.id, 'only-a'), 'valid')
    assert.equal(await getCommitQc(repo.id, 'sibling'), 'valid')
  })

  it('revoking individual commits leaves QC unchanged (ADR 0009)', async () => {
    const { markMergeRequestMerged } = await import('../src/packages/merge/index.js')
    const { id } = await recordBoundSignature({ source: 'src-ind', target: 'tgt-ind' })
    const mr = await openMergeRequest({
      repositoryId: repo.id,
      namespace: 'rev-ns',
      repo: 'data',
      sourceBranch: 'feature-ind',
      targetBranch: 'main',
      expectedSourceHead: 'src-ind',
      expectedTargetHead: 'tgt-ind',
      openedBy: approver,
    })
    await markMergeRequestMerged(mr.id, { mergeCommitId: 'merge-ind' })
    await markCommitsQc(repo.id, ['src-ind', 'merge-ind'], 'valid', {
      mergeRequestId: mr.id,
    })
    const result = await revokeSignature({
      signatureId: id,
      revoker: approver,
      reason: 'Revoke range tip only',
      changeControlId: 'CC-REV-IND',
      commitIds: ['src-ind'],
      notify: async () => {},
    })
    assert.equal(result.ok, true)
    assert.equal(await getCommitQc(repo.id, 'src-ind'), 'valid')
    assert.equal(await getCommitQc(repo.id, 'merge-ind'), 'valid')
  })

  it('resolveSignatureForMergeRequest finds the bound approval signature', async () => {
    const { resolveSignatureForMergeRequest, markMergeRequestMerged } = await import(
      '../src/packages/merge/index.js'
    )
    const { id } = await recordBoundSignature({ source: 'src-res', target: 'tgt-res' })
    const mr = await openMergeRequest({
      repositoryId: repo.id,
      namespace: 'rev-ns',
      repo: 'data',
      sourceBranch: 'feature-res',
      targetBranch: 'main',
      expectedSourceHead: 'src-res',
      expectedTargetHead: 'tgt-res',
      openedBy: approver,
    })
    await markMergeRequestMerged(mr.id, { mergeCommitId: 'merge-res' })
    const found = await resolveSignatureForMergeRequest(await getMergeRequest(mr.id)!)
    assert.ok(found)
    assert.equal(found.signatureId, id)
    assert.equal(found.revoked, false)
  })

  it('resolveSignatureCoveringCommit resolves via QC merge-request link', async () => {
    const { resolveSignatureCoveringCommit, markMergeRequestMerged } = await import(
      '../src/packages/merge/index.js'
    )
    const { id } = await recordBoundSignature({ source: 'src-cov', target: 'tgt-cov' })
    const mr = await openMergeRequest({
      repositoryId: repo.id,
      namespace: 'rev-ns',
      repo: 'data',
      sourceBranch: 'feature-cov',
      targetBranch: 'main',
      expectedSourceHead: 'src-cov',
      expectedTargetHead: 'tgt-cov',
      openedBy: approver,
    })
    await markMergeRequestMerged(mr.id, { mergeCommitId: 'merge-cov' })
    await markCommitsQc(repo.id, ['src-cov', 'merge-cov'], 'valid', {
      mergeRequestId: mr.id,
    })
    const viaRange = await resolveSignatureCoveringCommit({
      repositoryId: repo.id,
      namespace: 'rev-ns',
      repo: 'data',
      commitId: 'src-cov',
    })
    assert.ok(viaRange)
    assert.equal(viaRange.signatureId, id)
    const viaMerge = await resolveSignatureCoveringCommit({
      repositoryId: repo.id,
      namespace: 'rev-ns',
      repo: 'data',
      commitId: 'merge-cov',
    })
    assert.ok(viaMerge)
    assert.equal(viaMerge.signatureId, id)
  })
})

describe('signature revocation revert (gxp/10a #159)', () => {
  it('appends a linked revert without flipping QC, and keeps signature + revoke visible', async () => {
    const { id } = await recordBoundSignature({ source: 's-rev', target: 't-rev' })
    await markCommitsQc(repo.id, ['s-rev', 'c-rev'], 'valid')
    const revoked = await revokeSignature({
      signatureId: id,
      revoker: approver,
      reason: 'Batch failed assay',
      changeControlId: 'CC-REVERT-REV',
      commitIds: ['s-rev', 'c-rev'],
      notify: async () => {},
    })
    assert.equal(revoked.ok, true)
    if (!revoked.ok) return
    assert.equal(await getCommitQc(repo.id, 's-rev'), 'valid')

    const notified: Array<{ summary: string }> = []
    const result = await revertSignatureRevocation({
      signatureId: id,
      revocationId: revoked.revocation.id,
      reverter: approver,
      reason: 'Assay re-run passed; restore QC',
      changeControlId: 'CC-REVERT-1',
      notify: async (event) => {
        notified.push({ summary: event.summary })
      },
    })
    assert.equal(result.ok, true)
    if (!result.ok) return

    const { signatureStore } = await import('../src/packages/authentication/lib/signing/signatureStore.js')
    const store = await signatureStore()
    assert.ok(await store.get(id), 'original signature must remain')
    const revs = await store.listRevocations(id)
    assert.equal(revs.length, 1, 'original revoke record stays')
    const reverts = await store.listRevocationReverts(id)
    assert.equal(reverts.length, 1)
    assert.equal(reverts[0]?.revocationId, revoked.revocation.id)
    assert.equal(await getCommitQc(repo.id, 's-rev'), 'valid')
    assert.equal(await getCommitQc(repo.id, 'c-rev'), 'valid')
    assert.equal((await store.listRevokedSignatureIds()).has(id), false)
    assert.ok(notified.length >= 1)
    assert.match(notified[0]!.summary, /revert/i)
  })

  it('refuses non-Approvers and double-revert', async () => {
    const outsider = t.person('outsider')
    await preparePrincipal(outsider)
    await t.grantRole(outsider, 'user')
    const { id } = await recordBoundSignature({ source: 's-deny', target: 't-deny' })
    await markCommitsQc(repo.id, ['s-deny'], 'valid')
    const revoked = await revokeSignature({
      signatureId: id,
      revoker: approver,
      reason: 'Fail then deny revert',
      changeControlId: 'CC-REVERT-DENY-R',
      commitIds: ['s-deny'],
      notify: async () => {},
    })
    assert.equal(revoked.ok, true)
    if (!revoked.ok) return

    const denied = await revertSignatureRevocation({
      signatureId: id,
      revocationId: revoked.revocation.id,
      reverter: outsider,
      reason: 'Not an Approver trying revert',
      changeControlId: 'CC-REVERT-DENY',
      notify: async () => {},
    })
    assert.equal(denied.ok, false)
    if (denied.ok) return
    assert.equal(denied.status, 403)

    const first = await revertSignatureRevocation({
      signatureId: id,
      revocationId: revoked.revocation.id,
      reverter: approver,
      reason: 'First revert succeeds',
      changeControlId: 'CC-REVERT-OK',
      notify: async () => {},
    })
    assert.equal(first.ok, true)

    const second = await revertSignatureRevocation({
      signatureId: id,
      revocationId: revoked.revocation.id,
      reverter: approver,
      reason: 'Second revert must fail',
      changeControlId: 'CC-REVERT-2X',
      notify: async () => {},
    })
    assert.equal(second.ok, false)
    if (second.ok) return
    assert.equal(second.status, 409)
  })
})
