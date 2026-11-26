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

/**
 * Seam: Owner signed unmark-validated HTTP (#119).
 * Catches: refuse+audit without signature; default branch unmarked only via
 *          ceremony; write gate treats unmarked branch as non-validated.
 * Misses: UI.
 */
const t = isolatedAuth({ AUTHZ_BOOTSTRAP_ADMINS: 'root@x.io' })
after(() => t.restore())

const { createNamespaceAuthz } = await import('../../src/packages/authz/lib/authzNamespaceStore.js')
const { ensureRepository } = await import('../../src/packages/authz/lib/repositoryStore.js')
const { preparePrincipal } = await import('../../src/packages/authz/lib/authz.js')
const { setRepoCollaborator } = await import('../../src/packages/authz/lib/authzCollaboratorStore.js')
const { registerMergeRequestRoutes } = await import('../../src/packages/merge/lib/mergeRequestRoutes.js')
const { openSignatureStore, useSignatureStore } = await import(
  '../../src/packages/authentication/lib/signing/signatureStore.js'
)
const { immudbConfig, openLedger } = await import('../../src/packages/audit/lib/auditLedger.js')
const { auditMutation } = await import('../../src/packages/audit/lib/auditMutation.js')
const { queryAudit } = await import('../../src/packages/audit/lib/audit.js')
const {
  decideValidatedBranchWrite,
  ensureDefaultBranchValidated,
  listValidatedBranches,
  markBranchValidated,
} = await import('../../src/packages/merge/index.js')

useSignatureStore(
  openSignatureStore(
    await openLedger({
      ...immudbConfig(),
      prefix: `vb-unmark/${randomBytes(4).toString('hex')}/`,
    }),
  ),
)

const owner = t.person('vb-unmark-owner')
await preparePrincipal(owner)
await t.grantRole(owner, 'manager')
assert.equal((await createNamespaceAuthz(owner, 'vb-unmark', 'none')).ok, true)
const repo = await ensureRepository('vb-unmark', 'assay')
assert.ok(repo)
await ensureDefaultBranchValidated(repo.id, 'main')
await setRepoCollaborator('vb-unmark', 'assay', owner, 'admin')

const app = new Hono()
registerMergeRequestRoutes(app, { audit: auditMutation })

const cookie = async (u: typeof owner) =>
  sealedSessionCookie({ ...u, sessionStart: Math.floor(Date.now() / 1000) })

describe('DELETE /auth/repos/:ns/:repo/validated-branches/:branch (#119)', () => {
  it('refuses without a mutation e-signature and audits the refusal', async () => {
    const path = '/auth/repos/vb-unmark/assay/validated-branches/main'
    const before = (await queryAudit({ action: 'request.rejected', limit: 200 })).events.length
    const res = await app.request(path, {
      method: 'DELETE',
      headers: {
        'content-type': 'application/json',
        cookie: await cookie(owner),
        'x-mice-reason': 'Demote default from validated assay line',
      },
      body: '{}',
    })
    assert.equal(res.status, 400)
    const json = (await res.json()) as { code?: string }
    assert.equal(json.code, 'signature_required')

    const rejected = (await queryAudit({ action: 'request.rejected', limit: 200 })).events
    assert.ok(rejected.length > before)
    const hit = rejected.find(
      (e) =>
        e.path === path &&
        (e.detail as { reason?: string } | undefined)?.reason === 'signature_required',
    )
    assert.ok(hit, 'expected audited signature_required refusal')
  })

  it('Owner unmarks default with ceremony; write gate allows tip writes; audited', async () => {
    const path = '/auth/repos/vb-unmark/assay/validated-branches/main'
    const body = {}
    const headers = await regulatedMutationHeaders(owner, {
      method: 'DELETE',
      path,
      body,
      reason: 'Demote default from validated assay line after line retirement',
    })
    const res = await app.request(path, {
      method: 'DELETE',
      headers: {
        ...headers,
        cookie: await cookie(owner),
        'x-mice-change-control-id': 'CC-2026-119-unmark-main',
      },
      body: JSON.stringify(body),
    })
    const json = (await res.json()) as {
      validatedBranches?: string[]
      validated?: boolean
      branch?: string
      error?: string
    }
    assert.equal(res.status, 200, JSON.stringify(json))
    assert.equal(json.branch, 'main')
    assert.equal(json.validated, false)
    assert.equal(json.validatedBranches?.includes('main'), false)

    const validated = await listValidatedBranches(repo.id)
    assert.equal(validated.includes('main'), false)
    assert.equal(
      decideValidatedBranchWrite({
        action: 'file.write',
        branch: 'main',
        validatedBranches: validated,
      }).allow,
      true,
    )

    const events = (await queryAudit({ action: 'validated_branch.unmark', limit: 20 })).events
    const hit = events.find(
      (e) =>
        e.namespace === 'vb-unmark' &&
        e.repo === 'assay' &&
        (e.detail as { branch?: string } | undefined)?.branch === 'main',
    )
    assert.ok(hit, 'expected validated_branch.unmark audit')
    assert.equal(hit.change_control_id, 'CC-2026-119-unmark-main')
    assert.ok(hit.signature_id)
  })

  it('Owner unmarks a previously marked feature; feature tip writes allowed', async () => {
    await markBranchValidated({
      repositoryId: repo.id,
      branch: 'feature',
      markedBy: `${owner.iss}|${owner.sub}`,
      reason: 'Promote feature for temporary assay line',
      changeControlId: 'CC-2026-119-mark-feature',
    })
    assert.ok((await listValidatedBranches(repo.id)).includes('feature'))

    const path = '/auth/repos/vb-unmark/assay/validated-branches/feature'
    const body = {}
    const headers = await regulatedMutationHeaders(owner, {
      method: 'DELETE',
      path,
      body,
      reason: 'Retire feature validated line after assay closeout',
    })
    const res = await app.request(path, {
      method: 'DELETE',
      headers: {
        ...headers,
        cookie: await cookie(owner),
        'x-mice-change-control-id': 'CC-2026-119-unmark-feature',
      },
      body: JSON.stringify(body),
    })
    assert.equal(res.status, 200)
    const validated = await listValidatedBranches(repo.id)
    assert.equal(validated.includes('feature'), false)
    assert.equal(
      decideValidatedBranchWrite({
        action: 'file.write',
        branch: 'feature',
        validatedBranches: validated,
      }).allow,
      true,
    )
  })
})
