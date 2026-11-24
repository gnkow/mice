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
const { registerMergeRequestRoutes } = await import('./mergeRequestRoutes.js')
const { openSignatureStore, useSignatureStore } = await import(
  './authentication/signing/signatureStore.js'
)
const { buildMergeManifest, mergeResultBinding } = await import(
  './authentication/signing/mergeManifest.js'
)
const { immudbConfig, openLedger } = await import('./auditLedger.js')

useSignatureStore(
  openSignatureStore(
    await openLedger({
      ...immudbConfig(),
      prefix: `revoke-http/${randomBytes(4).toString('hex')}/`,
    }),
  ),
)

const approver = t.person('revoker-http')
await preparePrincipal(approver)
await t.grantRole(approver, 'manager')
assert.equal((await createNamespaceAuthz(approver, 'rev-http', 'none')).ok, true)
const repo = await ensureRepository('rev-http', 'data')
assert.ok(repo)
await grantApprover({ ns: 'rev-http', repo: 'data' }, approver)

const app = new Hono()
registerMergeRequestRoutes(app, { audit: async () => {} })

const cookie = async () =>
  sealedSessionCookie({ ...approver, sessionStart: Math.floor(Date.now() / 1000) })

async function recordBoundSignature() {
  const merge = buildMergeManifest([])
  const { binding, manifest } = mergeResultBinding({
    repo: 'rev-http/data',
    sourceHead: 'src-http',
    targetHead: 'tgt-http',
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
    changeControlId: 'CC-REV-HTTP',
  })
}

describe('POST /auth/signatures/:id/revoke (gxp/07 HTTP)', () => {
  it('refuses without a mutation e-signature (GXP-R-013 / step-up ceremony)', async () => {
    const { id } = await recordBoundSignature()
    const res = await app.request(`/auth/signatures/${id}/revoke`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: await cookie(),
        'x-mice-reason': 'QC failure on assay batch - revoke for audit',
        // omit x-mice-signature-id
      },
      body: '{}',
    })
    assert.equal(res.status, 400)
    const json = (await res.json()) as { code?: string }
    assert.equal(json.code, 'signature_required')
  })
})
