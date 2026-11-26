import '../../src/db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { randomBytes } from 'node:crypto'
import { Hono } from 'hono'
import {
  isolatedAuth,
  regulatedMutationHeaders,
  sealedSessionCookie,
} from '../../src/packages/shared/lib/testSupport.js'

const t = isolatedAuth({ AUTHZ_BOOTSTRAP_ADMINS: 'root@x.io' })
after(() => t.restore())

const { createNamespaceAuthz } = await import('../../src/packages/authz/lib/authzNamespaceStore.js')
const { ensureRepository } = await import('../../src/packages/authz/lib/repositoryStore.js')
const { preparePrincipal } = await import('../../src/packages/authz/lib/authz.js')
const { setRepoCollaborator } = await import('../../src/packages/authz/lib/authzCollaboratorStore.js')
const { grantApprover } = await import('../../src/packages/authz/lib/authzApproverStore.js')
const { registerMergeRequestRoutes } = await import(
  '../../src/packages/merge/lib/mergeRequestRoutes.js'
)
const { getCommitQc } = await import('../../src/packages/merge/lib/commitQcStore.js')
const { openSignatureStore, useSignatureStore } = await import(
  '../../src/packages/authentication/lib/signing/signatureStore.js'
)
const { immudbConfig, openLedger } = await import('../../src/packages/audit/lib/auditLedger.js')
const { queryAudit } = await import('../../src/packages/audit/lib/audit.js')

useSignatureStore(
  openSignatureStore(
    await openLedger({ ...immudbConfig(), prefix: `qc-unmark/${randomBytes(4).toString('hex')}/` }),
  ),
)

const manager = t.person('manager')
await preparePrincipal(manager)
await t.grantRole(manager, 'manager')
assert.equal((await createNamespaceAuthz(manager, 'unmark-ns', 'none')).ok, true)
const repo = await ensureRepository('unmark-ns', 'study')
assert.ok(repo)
await setRepoCollaborator('unmark-ns', 'study', manager, 'maintain')
await grantApprover({ ns: 'unmark-ns', repo: 'study' }, { kind: 'user', ...manager })

const app = new Hono()
registerMergeRequestRoutes(app, { audit: async () => {} })

const cookie = async () =>
  sealedSessionCookie({ ...manager, sessionStart: Math.floor(Date.now() / 1000) })

async function openMarkedMr(sourceBranch: string, commitIds: string[]) {
  const path = '/auth/repos/unmark-ns/study/merge-requests'
  const body = {
    sourceBranch,
    targetBranch: 'main',
    expectedSourceHead: `${sourceBranch}-src`,
    expectedTargetHead: `${sourceBranch}-tgt`,
    commitIds,
  }
  const headers = await regulatedMutationHeaders(manager, { method: 'POST', path, body })
  const created = await app.request(path, {
    method: 'POST',
    headers: { ...headers, cookie: await cookie() },
    body: JSON.stringify(body),
  })
  assert.equal(created.status, 201, await created.clone().text())
  return ((await created.json()) as { mergeRequest: { id: string } }).mergeRequest
}

describe('MR cancel/reject unmarks QC Marked', () => {
  it('cancel clears Marked for the MR commits and audits unmarked ids', async () => {
    const mr = await openMarkedMr('cancel-unmark', ['cu-a', 'cu-b'])
    assert.equal(await getCommitQc(repo.id, 'cu-a'), 'marked')

    const cancelPath = `/auth/merge-requests/${mr.id}/cancel`
    const cancelHeaders = await regulatedMutationHeaders(manager, {
      method: 'POST',
      path: cancelPath,
      body: {},
    })
    const cancelled = await app.request(cancelPath, {
      method: 'POST',
      headers: { ...cancelHeaders, cookie: await cookie() },
      body: JSON.stringify({}),
    })
    assert.equal(cancelled.status, 200, await cancelled.clone().text())
    assert.equal(await getCommitQc(repo.id, 'cu-a'), 'none')
    assert.equal(await getCommitQc(repo.id, 'cu-b'), 'none')

    const { events } = await queryAudit({ action: 'merge_request.cancel', limit: 20 })
    const hit = events.find(
      (e) =>
        e.detail &&
        typeof e.detail === 'object' &&
        (e.detail as { mergeRequestId?: string }).mergeRequestId === mr.id,
    )
    assert.ok(hit, 'expected merge_request.cancel audit')
    const ids = ((hit.detail as { unmarkedCommitIds?: string[] }).unmarkedCommitIds ?? []).slice()
    assert.deepEqual(ids.sort(), ['cu-a', 'cu-b'])
  })

  it('reject clears Marked for the MR commits and audits unmarked ids', async () => {
    const mr = await openMarkedMr('reject-unmark', ['ru-a'])
    assert.equal(await getCommitQc(repo.id, 'ru-a'), 'marked')

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
    assert.equal(rejected.status, 200, await rejected.clone().text())
    assert.equal(await getCommitQc(repo.id, 'ru-a'), 'none')

    const { events } = await queryAudit({ action: 'merge_request.reject', limit: 20 })
    const hit = events.find(
      (e) =>
        e.detail &&
        typeof e.detail === 'object' &&
        (e.detail as { mergeRequestId?: string }).mergeRequestId === mr.id,
    )
    assert.ok(hit, 'expected merge_request.reject audit')
    const ids = ((hit.detail as { unmarkedCommitIds?: string[] }).unmarkedCommitIds ?? []).slice()
    assert.deepEqual(ids, ['ru-a'])
  })
})
