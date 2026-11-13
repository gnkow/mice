import './db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { randomBytes } from 'node:crypto'
import { isolatedAuth, regulatedMutationHeaders } from './testSupport.js'
import {
  inventoryCreateExemptActions,
  inventoryRequiredDatasetActions,
  reasonPolicyInventory,
} from './reasonPolicyInventory.js'
import { mutationNeedsReason, reasonRequiredActions } from './auditReason.js'

const t = isolatedAuth({ AUTHZ_BOOTSTRAP_ADMINS: 'root@x.io' })
after(() => t.restore())

const { Hono } = await import('hono')
const { registerMetaRoutes } = await import('./metaRoutes.js')
const { registerAuditRoutes } = await import('./auditRoutes.js')
const { preparePrincipal } = await import('./authz.js')
const { sealedSessionCookie } = await import('./testSupport.js')
const { openSignatureStore, useSignatureStore } = await import('./authentication/signing/signatureStore.js')
const { immudbConfig, openLedger } = await import('./auditLedger.js')

useSignatureStore(
  openSignatureStore(
    await openLedger({ ...immudbConfig(), prefix: `esign-rpi/${randomBytes(4).toString('hex')}/` }),
  ),
)

const manager = t.person('manager')
await preparePrincipal(manager)
await t.grantRole(manager, 'manager')

const app = new Hono()
registerMetaRoutes(app)
registerAuditRoutes(app, { audit: async () => {} })

const cookie = async () => sealedSessionCookie({ ...manager, sessionStart: Math.floor(Date.now() / 1000) })

describe('reason policy inventory (unit)', () => {
  it('lists every dataset/synthetic action and every exempt row has a rationale', () => {
    const rows = reasonPolicyInventory()
    assert.ok(rows.length >= 20)
    assert.ok(rows.some((r) => r.surface === 'dataset'))
    assert.ok(rows.some((r) => r.surface === 'bff'))
    for (const row of rows) {
      if (row.reason === 'exempt') {
        assert.ok(row.rationale && row.rationale.length > 10, row.id)
      }
      assert.ok(row.coverage.length > 0, row.id)
    }
  })

  it('required dataset keys match reasonRequiredActions() / mutationNeedsReason', () => {
    assert.deepEqual(inventoryRequiredDatasetActions(), reasonRequiredActions())
    for (const action of inventoryRequiredDatasetActions()) {
      assert.equal(mutationNeedsReason(action), true, action)
    }
    for (const action of inventoryCreateExemptActions()) {
      assert.equal(mutationNeedsReason(action), false, action)
    }
  })
})

describe('reason policy inventory (HTTP gaps closed here)', () => {
  it('meta write refuses without category + free text and accepts with them past the reason gate', async () => {
    const path = '/auth/meta'
    const body = { ref: { type: 'repository', id: 'ns/r' }, labels: { a: '1' } }
    const bare = await app.request(path, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: await cookie(),
      },
      body: JSON.stringify(body),
    })
    assert.equal(bare.status, 400)
    const bareJson = (await bare.json()) as { code?: string }
    assert.equal(bareJson.code, 'reason_required')

    const okHeaders = await regulatedMutationHeaders(manager, { method: 'PUT', path, body })
    const withReason = await app.request(path, {
      method: 'PUT',
      headers: { ...okHeaders, cookie: await cookie() },
      body: JSON.stringify(body),
    })
    // Past reason/signature; may still 4xx on authz/validation — must not be a reason code.
    const withJson = (await withReason.json().catch(() => ({}))) as { code?: string }
    assert.notEqual(withJson.code, 'reason_required')
    assert.notEqual(withJson.code, 'reason_category_required')
    assert.notEqual(withJson.code, 'signature_required')
  })

  it('meta delete refuses without a reason', async () => {
    const path = '/auth/meta?type=repository&id=ns%2Fr'
    const bare = await app.request(path, {
      method: 'DELETE',
      headers: { cookie: await cookie() },
    })
    assert.equal(bare.status, 400)
    assert.equal(((await bare.json()) as { code?: string }).code, 'reason_required')
  })

  it('lineage rebuild refuses without a reason and accepts with ceremony past the reason gate', async () => {
    const path = '/auth/lineage/rebuild'
    const body = { namespace: 'ns', repo: 'r', path: 'a.csv' }
    const bare = await app.request(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: await cookie(),
      },
      body: JSON.stringify(body),
    })
    assert.equal(bare.status, 400)
    assert.equal(((await bare.json()) as { code?: string }).code, 'reason_required')

    const okHeaders = await regulatedMutationHeaders(manager, { method: 'POST', path, body })
    const withReason = await app.request(path, {
      method: 'POST',
      headers: { ...okHeaders, cookie: await cookie() },
      body: JSON.stringify(body),
    })
    const withJson = (await withReason.json().catch(() => ({}))) as { code?: string }
    assert.notEqual(withJson.code, 'reason_required')
    assert.notEqual(withJson.code, 'signature_required')
  })
})
