import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { EMPTY_AUDIT_CHANGE } from '../../src/packages/audit/lib/auditChange.js'
import { leaseEventChange, storeEventChange } from '../../src/packages/workspaces/lib/systemAuditChange.js'

describe('storeEventChange', () => {
  it('checkout.build: null → the built checkout', () => {
    const change = storeEventChange({
      action: 'checkout.build',
      namespace: 'ns',
      repo: 'r',
      detail: { commit: 'c1', files: 3, bytes: 30, new_bytes: 10, downloaded_files: 1, linked_files: 2, build_ms: 5 },
    })
    assert.equal(change.before, null)
    assert.deepEqual(change.after, {
      checkout: 'ns/r/c1',
      commit: 'c1',
      path: 'ns/r/c1',
      files: 3,
      bytes: 30,
      new_bytes: 10,
      downloaded_files: 1,
      linked_files: 2,
    })
  })

  it('checkout.evict: the checkout → null', () => {
    const change = storeEventChange({
      action: 'checkout.evict',
      namespace: 'ns',
      repo: 'r',
      detail: { commit: 'c1', reason: 'manual', files: 3, bytes: 30 },
    })
    assert.deepEqual(change, {
      before: { checkout: 'ns/r/c1', commit: 'c1', path: 'ns/r/c1', files: 3, bytes: 30 },
      after: null,
    })
  })

  it('checkout.corrupt: ready → corrupt', () => {
    const change = storeEventChange({
      action: 'checkout.corrupt',
      namespace: 'ns',
      repo: 'r',
      detail: { commit: 'c1', sha256: 'abc' },
    })
    assert.deepEqual(change, {
      before: { 'checkout.ns/r/c1': 'ready' },
      after: { 'checkout.ns/r/c1': 'corrupt' },
    })
  })

  it('store.gc: counts before → after when the event states them', () => {
    const change = storeEventChange({
      action: 'store.gc',
      detail: { blob_count: 8, blobs_deleted: 2, store_bytes: 60, bytes_freed: 40, evicted: ['ns/r/c1'] },
    })
    assert.deepEqual(change, {
      before: { blob_count: 10, store_bytes: 100, 'checkout.ns/r/c1': 'ready' },
      after: { blob_count: 8, store_bytes: 60, 'checkout.ns/r/c1': null },
    })
  })

  it('store.gc: a run that collected nothing is empty', () => {
    assert.deepEqual(
      storeEventChange({ action: 'store.gc', detail: { blob_count: 8, blobs_deleted: 0, store_bytes: 60, bytes_freed: 0 } }),
      EMPTY_AUDIT_CHANGE,
    )
  })

  it('store.full: a capacity signal, empty by design (non_mutation)', () => {
    assert.deepEqual(storeEventChange({ action: 'store.full', detail: { store_bytes: 9, max_bytes: 10 } }), EMPTY_AUDIT_CHANGE)
  })
})

describe('leaseEventChange', () => {
  it('workspace.lease.release (auto): held lease → null', () => {
    const holder = { kind: 'session', id: 's1' }
    const change = leaseEventChange({
      action: 'workspace.lease.release',
      detail: { workspace_id: 'w1', lease_id: 'l1', mode: 'write', holder, reason: 'expired' },
    })
    assert.deepEqual(change, {
      before: { lease_id: 'l1', workspace_id: 'w1', mode: 'write', holder },
      after: null,
    })
  })
})
