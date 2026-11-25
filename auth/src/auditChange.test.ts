import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  EMPTY_AUDIT_CHANGE,
  auditChange,
  isEmptyAuditChange,
  NoChangeError,
  requireAuditChange,
} from './auditChange.js'

describe('auditChange', () => {
  it('keeps only changed keys on update (missing → null)', () => {
    assert.deepEqual(
      auditChange({ description: null, name: 'n' }, { description: 'example', name: 'n' }),
      { before: { description: null }, after: { description: 'example' } },
    )
  })

  it('create is null → full content', () => {
    assert.deepEqual(auditChange(null, { name: 'ns', description: 'd' }), {
      before: null,
      after: { name: 'ns', description: 'd' },
    })
  })

  it('delete is full content → null', () => {
    assert.deepEqual(auditChange({ name: 'ns' }, null), {
      before: { name: 'ns' },
      after: null,
    })
  })

  it('identical snapshots yield empty change', () => {
    assert.equal(isEmptyAuditChange(auditChange({ a: 1 }, { a: 1 })), true)
    assert.deepEqual(auditChange({ a: 1 }, { a: 1 }), EMPTY_AUDIT_CHANGE)
  })

  it('requireAuditChange refuses no-ops', () => {
    assert.throws(() => requireAuditChange({ a: 1 }, { a: 1 }), NoChangeError)
    assert.deepEqual(requireAuditChange({ a: 1 }, { a: 2 }), {
      before: { a: 1 },
      after: { a: 2 },
    })
  })
})
