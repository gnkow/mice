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
 * Seam: mark-validated HTTP (#116).
 * Catches: step-up signature required; Owner/maintain can mark; writer denied; write gate.
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
const {
  decideValidatedBranchWrite,
  ensureDefaultBranchValidated,
  listValidatedBranches,
} = await import('../../src/packages/merge/index.js')

useSignatureStore(
  openSignatureStore(
    await openLedger({
      ...immudbConfig(),
      prefix: `vb-mark/${randomBytes(4).toString('hex')}/`,
    }),
  ),
)

const owner = t.person('vb-mark-owner')
await preparePrincipal(owner)
await t.grantRole(owner, 'manager')
assert.equal((await createNamespaceAuthz(owner, 'vb-mark', 'none')).ok, true)
const repo = await ensureRepository('vb-mark', 'assay')
assert.ok(repo)
await ensureDefaultBranchValidated(repo.id, 'main')
await setRepoCollaborator('vb-mark', 'assay', owner, 'admin')

const writer = t.person('vb-mark-writer')
await preparePrincipal(writer)
await t.grantRole(writer, 'user')
await setRepoCollaborator('vb-mark', 'assay', writer, 'write')

const manager = t.person('vb-mark-manager')
await preparePrincipal(manager)
await t.grantRole(manager, 'user')
await setRepoCollaborator('vb-mark', 'assay', manager, 'maintain')

const app = new Hono()
registerMergeRequestRoutes(app, { audit: async () => {} })

const cookie = async (u: typeof owner) =>
  sealedSessionCookie({ ...u, sessionStart: Math.floor(Date.now() / 1000) })

describe('POST /auth/repos/:ns/:repo/validated-branches (#116)', () => {
  it('refuses without a mutation e-signature (step-up ceremony)', async () => {
    const path = '/auth/repos/vb-mark/assay/validated-branches'
    const res = await app.request(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: await cookie(owner),
        'x-mice-reason': 'Promote feature to validated assay line',
      },
      body: JSON.stringify({ branch: 'feature' }),
    })
    assert.equal(res.status, 400)
    const json = (await res.json()) as { code?: string }
    assert.equal(json.code, 'signature_required')
  })

  it('Owner marks feature validated; write gate refuses feature and allows develop', async () => {
    const path = '/auth/repos/vb-mark/assay/validated-branches'
    const body = { branch: 'feature' }
    const headers = await regulatedMutationHeaders(owner, {
      method: 'POST',
      path,
      body,
      reason: 'Promote feature to validated assay line for release',
    })
    const res = await app.request(path, {
      method: 'POST',
      headers: {
        ...headers,
        cookie: await cookie(owner),
        'x-mice-change-control-id': 'CC-2026-116-mark',
      },
      body: JSON.stringify(body),
    })
    const json = (await res.json()) as {
      validatedBranches?: string[]
      error?: string
    }
    assert.equal(res.status, 200, JSON.stringify(json))
    assert.ok(json.validatedBranches?.includes('main'))
    assert.ok(json.validatedBranches?.includes('feature'))

    const validated = await listValidatedBranches(repo.id)
    assert.equal(
      decideValidatedBranchWrite({
        action: 'file.write',
        branch: 'feature',
        validatedBranches: validated,
      }).allow,
      false,
    )
    assert.equal(
      decideValidatedBranchWrite({
        action: 'file.write',
        branch: 'develop',
        validatedBranches: validated,
      }).allow,
      true,
    )
  })

  it('write collaborator cannot mark a branch validated', async () => {
    const path = '/auth/repos/vb-mark/assay/validated-branches'
    const body = { branch: 'develop' }
    const headers = await regulatedMutationHeaders(writer, {
      method: 'POST',
      path,
      body,
      reason: 'Writer attempts to mark develop validated without manager seat',
    })
    const res = await app.request(path, {
      method: 'POST',
      headers: {
        ...headers,
        cookie: await cookie(writer),
        'x-mice-change-control-id': 'CC-2026-116-deny',
      },
      body: JSON.stringify(body),
    })
    assert.equal(res.status, 403)
  })

  it('maintain collaborator can mark a branch validated', async () => {
    const path = '/auth/repos/vb-mark/assay/validated-branches'
    const body = { branch: 'develop' }
    const headers = await regulatedMutationHeaders(manager, {
      method: 'POST',
      path,
      body,
      reason: 'Manager promotes develop to validated assay line',
    })
    const res = await app.request(path, {
      method: 'POST',
      headers: {
        ...headers,
        cookie: await cookie(manager),
        'x-mice-change-control-id': 'CC-2026-116-maintain',
      },
      body: JSON.stringify(body),
    })
    const json = (await res.json()) as { validatedBranches?: string[]; error?: string }
    assert.equal(res.status, 200, JSON.stringify(json))
    assert.ok(json.validatedBranches?.includes('develop'))
  })
})
