import './db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { randomBytes } from 'node:crypto'
import { isolatedAuth } from './testSupport.js'

const t = isolatedAuth({ AUTHZ_BOOTSTRAP_ADMINS: 'root@x.io' })
after(() => t.restore())

const { createNamespaceAuthz } = await import('./authzNamespaceStore.js')
const { ensureRepository } = await import('./repositoryStore.js')
const { preparePrincipal } = await import('./authz.js')
const { grantApprover } = await import('./authzApproverStore.js')
const { openMergeRequest, getMergeRequest } = await import('./mergeRequestStore.js')
const { getCommitQc, markCommitsQc } = await import('./commitQcStore.js')
const { revokeSignature } = await import('./signatureRevoke.js')
const { openSignatureStore, useSignatureStore } = await import('./authentication/signing/signatureStore.js')
const { buildMergeManifest, mergeResultBinding } = await import('./authentication/signing/mergeManifest.js')
const { immudbConfig, openLedger } = await import('./auditLedger.js')

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

async function recordBoundSignature(heads: { source: string; target: string }) {
  const merge = buildMergeManifest([])
  const { binding, manifest } = mergeResultBinding({
    repo: 'rev-ns/data',
    sourceHead: heads.source,
    targetHead: heads.target,
    merge,
  })
  const { signatureStore } = await import('./authentication/signing/signatureStore.js')
  return (
    await signatureStore()
  ).record({
    signer: { iss: approver.iss, sub: approver.sub, name: approver.name },
    meaning: 'Approved',
    contentHash: binding.manifestDigest,
    binding,
    manifest,
    changeControlId: 'CC-REV-1',
  })
}

describe('signature revoke (gxp/07/08/09)', () => {
  it('writes a linked revocation, marks QC Failed, and keeps the original signature', async () => {
    const { id } = await recordBoundSignature({ source: 's1', target: 't1' })
    await markCommitsQc(repo.id, ['s1', 'c-range'], 'passed')

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

    const { signatureStore } = await import('./authentication/signing/signatureStore.js')
    const store = await signatureStore()
    assert.ok(await store.get(id), 'original signature must remain')
    const revs = await store.listRevocations(id)
    assert.equal(revs.length, 1)
    assert.equal(revs[0]?.reason, 'QC failure on assay batch')
    assert.equal(await getCommitQc(repo.id, 's1'), 'failed')
    assert.equal(await getCommitQc(repo.id, 'c-range'), 'failed')
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
    assert.equal((await getMergeRequest(mr.id))?.status, 'blocked')
  })

  it('does not propagate failure to unlisted commits of the same signature', async () => {
    const { id } = await recordBoundSignature({ source: 'only-a', target: 'tgt-x' })
    await markCommitsQc(repo.id, ['only-a', 'sibling'], 'passed')
    const result = await revokeSignature({
      signatureId: id,
      revoker: approver,
      reason: 'Revoke one commit only',
      changeControlId: 'CC-REV-4',
      commitIds: ['only-a'],
      notify: async () => {},
    })
    assert.equal(result.ok, true)
    assert.equal(await getCommitQc(repo.id, 'only-a'), 'failed')
    assert.equal(await getCommitQc(repo.id, 'sibling'), 'passed')
  })
})
