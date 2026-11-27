import '../../src/db/testSchema.js'
import assert from 'node:assert/strict'
import { after, afterEach, describe, it } from 'node:test'
import { randomBytes } from 'node:crypto'
import { Hono } from 'hono'
import {
  isolatedAuth,
  regulatedMutationHeaders,
  sealedSessionCookie,
} from '../../src/packages/shared/lib/testSupport.js'

/**
 * Seam: mark-validated disposition of Unset tip commits (ADR 0009).
 * Catches: Approver required; explicit map; covering signatureId; self-Valid refused.
 * Misses: live oxen ancestry walk (injected tip history).
 */
const t = isolatedAuth({ AUTHZ_BOOTSTRAP_ADMINS: 'root@x.io' })
after(() => t.restore())

const { createNamespaceAuthz } = await import('../../src/packages/authz/lib/authzNamespaceStore.js')
const { ensureRepository } = await import('../../src/packages/authz/lib/repositoryStore.js')
const { preparePrincipal } = await import('../../src/packages/authz/lib/authz.js')
const { setRepoCollaborator } = await import('../../src/packages/authz/lib/authzCollaboratorStore.js')
const { grantApprover } = await import('../../src/packages/authz/lib/authzApproverStore.js')
const { registerMergeRequestRoutes } = await import('../../src/packages/merge/lib/mergeRequestRoutes.js')
const { openSignatureStore, useSignatureStore } = await import(
  '../../src/packages/authentication/lib/signing/signatureStore.js'
)
const { immudbConfig, openLedger } = await import('../../src/packages/audit/lib/auditLedger.js')
const {
  ensureDefaultBranchValidated,
  getCommitQc,
  listCommitQcForSignature,
  resolveSignatureCoveringCommit,
  setTipHistoryResolverForTests,
} = await import('../../src/packages/merge/index.js')
const { signerAuthorKey } = await import('../../src/packages/authentication/principal.js')

useSignatureStore(
  openSignatureStore(
    await openLedger({
      ...immudbConfig(),
      prefix: `vb-bless/${randomBytes(4).toString('hex')}/`,
    }),
  ),
)

const owner = t.person('vb-bless-owner')
await preparePrincipal(owner)
await t.grantRole(owner, 'manager')
assert.equal((await createNamespaceAuthz(owner, 'vb-bless', 'none')).ok, true)
const repo = await ensureRepository('vb-bless', 'assay')
assert.ok(repo)
await ensureDefaultBranchValidated(repo.id, 'main')
await setRepoCollaborator('vb-bless', 'assay', owner, 'admin')

const manager = t.person('vb-bless-manager')
await preparePrincipal(manager)
await t.grantRole(manager, 'user')
await setRepoCollaborator('vb-bless', 'assay', manager, 'maintain')

const approver = t.person('vb-bless-approver')
await preparePrincipal(approver)
await t.grantRole(approver, 'user')
await setRepoCollaborator('vb-bless', 'assay', approver, 'admin')
await grantApprover({ ns: 'vb-bless', repo: 'assay' }, approver)

const app = new Hono()
registerMergeRequestRoutes(app, { audit: async () => {} })

const cookie = async (u: typeof owner) =>
  sealedSessionCookie({ ...u, sessionStart: Math.floor(Date.now() / 1000) })

afterEach(() => setTipHistoryResolverForTests(null))

describe('POST mark-validated dispositions Unset tip (ADR 0009)', () => {
  it('refuses manager without Approver when tip has Unset history', async () => {
    setTipHistoryResolverForTests(async () => ({
      tip: 'feat-tip',
      commits: [
        { id: 'feat-tip', author: 'other|author', parentIds: ['feat-parent'] },
        { id: 'feat-parent', author: 'other|author', parentIds: [] },
      ],
      requiresApprover: true,
    }))
    const path = '/auth/repos/vb-bless/assay/validated-branches'
    const body = {
      branch: 'feature-unsigned',
      disposition: { 'feat-tip': 'valid', 'feat-parent': 'valid' },
    }
    const headers = await regulatedMutationHeaders(manager, {
      method: 'POST',
      path,
      body,
      reason: 'Manager tries to mark feature with Unset tip without Approver',
    })
    const res = await app.request(path, {
      method: 'POST',
      headers: {
        ...headers,
        cookie: await cookie(manager),
        'x-mice-change-control-id': 'CC-2026-bless-deny',
      },
      body: JSON.stringify(body),
    })
    assert.equal(res.status, 403)
    const json = (await res.json()) as { code?: string }
    assert.equal(json.code, 'approver_required')
  })

  it('refuses mark without disposition map for Unset tip commits', async () => {
    setTipHistoryResolverForTests(async () => ({
      tip: 'need-map-tip',
      commits: [{ id: 'need-map-tip', author: 'other|author', parentIds: ['p'] }],
      requiresApprover: true,
    }))
    const path = '/auth/repos/vb-bless/assay/validated-branches'
    const body = { branch: 'feature-need-map' }
    const headers = await regulatedMutationHeaders(approver, {
      method: 'POST',
      path,
      body,
      reason: 'Approver marks without disposition map',
    })
    const res = await app.request(path, {
      method: 'POST',
      headers: {
        ...headers,
        cookie: await cookie(approver),
        'x-mice-change-control-id': 'CC-2026-bless-map',
      },
      body: JSON.stringify(body),
    })
    assert.equal(res.status, 400)
    const json = (await res.json()) as { code?: string }
    assert.equal(json.code, 'disposition_required')
  })

  it('Approver mark applies disposition map and covering signature', async () => {
    setTipHistoryResolverForTests(async () => ({
      tip: 'bless-tip',
      commits: [
        { id: 'bless-tip', author: 'other|author', parentIds: ['bless-a'] },
        { id: 'bless-a', author: 'other|author', parentIds: [] },
      ],
      requiresApprover: true,
    }))
    const path = '/auth/repos/vb-bless/assay/validated-branches'
    const body = {
      branch: 'feature-bless',
      disposition: { 'bless-tip': 'valid', 'bless-a': 'invalid' },
    }
    const headers = await regulatedMutationHeaders(approver, {
      method: 'POST',
      path,
      body,
      reason: 'Approver promotes feature and dispositions Unset tip history',
    })
    const res = await app.request(path, {
      method: 'POST',
      headers: {
        ...headers,
        cookie: await cookie(approver),
        'x-mice-change-control-id': 'CC-2026-bless-ok',
      },
      body: JSON.stringify(body),
    })
    const json = (await res.json()) as {
      validatedBranches?: string[]
      blessedCommitIds?: string[]
      dispositionCommitIds?: string[]
      signatureId?: string
      error?: string
    }
    assert.equal(res.status, 200, JSON.stringify(json))
    assert.ok(json.validatedBranches?.includes('feature-bless'))
    assert.deepEqual(new Set(json.dispositionCommitIds ?? json.blessedCommitIds), new Set(['bless-tip', 'bless-a']))
    assert.ok(json.signatureId)

    assert.equal(await getCommitQc(repo.id, 'bless-tip'), 'valid')
    assert.equal(await getCommitQc(repo.id, 'bless-a'), 'invalid')

    const covered = await listCommitQcForSignature(json.signatureId!)
    assert.equal(covered.length, 2)

    const covering = await resolveSignatureCoveringCommit({
      repositoryId: repo.id,
      namespace: 'vb-bless',
      repo: 'assay',
      commitId: 'bless-a',
    })
    assert.ok(covering)
    assert.equal(covering!.signatureId, json.signatureId)
    assert.equal(covering!.revoked, false)
  })

  it('refuses Approver who would Valid their own Unset tip commits', async () => {
    setTipHistoryResolverForTests(async () => ({
      tip: 'self-tip',
      commits: [
        {
          id: 'self-tip',
          author: signerAuthorKey(approver),
          parentIds: ['self-parent'],
        },
      ],
      requiresApprover: true,
    }))
    const path = '/auth/repos/vb-bless/assay/validated-branches'
    const body = {
      branch: 'feature-self',
      disposition: { 'self-tip': 'valid' },
    }
    const headers = await regulatedMutationHeaders(approver, {
      method: 'POST',
      path,
      body,
      reason: 'Approver attempts to Valid their own tip commits',
    })
    const res = await app.request(path, {
      method: 'POST',
      headers: {
        ...headers,
        cookie: await cookie(approver),
        'x-mice-change-control-id': 'CC-2026-bless-self',
      },
      body: JSON.stringify(body),
    })
    assert.equal(res.status, 403)
    const json = (await res.json()) as { code?: string }
    assert.equal(json.code, 'self_valid')
  })
})
