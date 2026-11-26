import '../../src/db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { randomBytes } from 'node:crypto'
import { Hono } from 'hono'
import { isolatedAuth, sealedSessionCookie } from '../../src/packages/shared/lib/testSupport.js'

/**
 * Seam: signing-preview use-case (#158 audit addendum).
 * Catches: preview reconciles live tips like list/get (returns stale when tips moved).
 * Misses: UI Approve disabled; oxen manifest materialization (injected).
 */
const t = isolatedAuth({ AUTHZ_BOOTSTRAP_ADMINS: 'root@x.io' })
after(() => t.restore())

const { createNamespaceAuthz } = await import('../../src/packages/authz/lib/authzNamespaceStore.js')
const { ensureRepository } = await import('../../src/packages/authz/lib/repositoryStore.js')
const { preparePrincipal } = await import('../../src/packages/authz/lib/authz.js')
const { openMergeRequest } = await import('../../src/packages/merge/lib/mergeRequestStore.js')
const {
  registerMergeRequestRoutes,
  setMergeManifestResolverForTests,
  setLiveHeadsResolverForTests,
} = await import('../../src/packages/merge/lib/mergeRequestRoutes.js')
const { buildMergeManifest } = await import('../../src/packages/authentication/lib/signing/mergeManifest.js')
const { openSignatureStore, useSignatureStore } = await import(
  '../../src/packages/authentication/lib/signing/signatureStore.js'
)
const { immudbConfig, openLedger } = await import('../../src/packages/audit/lib/auditLedger.js')

useSignatureStore(
  openSignatureStore(
    await openLedger({ ...immudbConfig(), prefix: `preview-recon/${randomBytes(4).toString('hex')}/` }),
  ),
)

const reader = t.person('reader')
await preparePrincipal(reader)
await t.grantRole(reader, 'manager')
assert.equal((await createNamespaceAuthz(reader, 'prev', 'none')).ok, true)
const repo = await ensureRepository('prev', 'assay')
assert.ok(repo)
const { setRepoCollaborator } = await import('../../src/packages/authz/lib/authzCollaboratorStore.js')
await setRepoCollaborator('prev', 'assay', reader, 'read')

const app = new Hono()
registerMergeRequestRoutes(app, { audit: async () => {} })
after(() => {
  setMergeManifestResolverForTests(null)
  setLiveHeadsResolverForTests(null)
})

const cookie = async () =>
  sealedSessionCookie({ ...reader, sessionStart: Math.floor(Date.now() / 1000) })

describe('signing-preview reconciles live tips (#158)', () => {
  it('returns stale mergeRequest when live tips diverge from expected', async () => {
    const mr = await openMergeRequest({
      repositoryId: repo.id,
      namespace: 'prev',
      repo: 'assay',
      sourceBranch: 'feat',
      targetBranch: 'main',
      expectedSourceHead: 's-pin',
      expectedTargetHead: 't-pin',
      openedBy: { iss: reader.iss, sub: reader.sub },
    })

    setLiveHeadsResolverForTests(async () => ({
      sourceHead: 's-pin',
      targetHead: 't-moved',
    }))
    setMergeManifestResolverForTests(async () =>
      buildMergeManifest([{ path: 'a.txt', contentHash: 'aa'.repeat(32) }]),
    )

    const res = await app.request(`/auth/merge-requests/${mr.id}/signing-preview`, {
      headers: { cookie: await cookie() },
    })
    const body = (await res.json()) as {
      mergeRequest?: { status: string; expectedTargetHead: string }
      error?: string
    }
    assert.equal(res.status, 200, JSON.stringify(body))
    assert.equal(body.mergeRequest?.status, 'stale')
    assert.equal(body.mergeRequest?.expectedTargetHead, 't-pin')
  })
})
