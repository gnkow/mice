import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { textContainsSecret, validateAuditDetail } from './auditDetailPolicy.js'

describe('textContainsSecret', () => {
  it('detects mice_pat tokens', () => {
    assert.equal(textContainsSecret('pasted mice_pat_AB12CD34EF56GH78'), 'mice_pat')
  })

  it('detects bearer tokens', () => {
    assert.equal(textContainsSecret('Authorization Bearer abcdefghijklmnop'), 'bearer')
  })

  it('allows ordinary reasons', () => {
    assert.equal(textContainsSecret('Approved under CC-123 for assay fix'), null)
  })
})

describe('validateAuditDetail', () => {
  it('rejects forbidden detail keys on any action', () => {
    const r = validateAuditDetail({
      action: 'merge',
      detail: { password: 'x', base: 'c0' },
    })
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.rejection.code, 'audit_detail_forbidden')
  })

  it('rejects unknown keys only when the action has an allowlist', () => {
    const browse = validateAuditDetail({
      action: 'audit.browse',
      detail: { rows: 3, password: 'x' },
    })
    assert.equal(browse.ok, false)

    const open = validateAuditDetail({
      action: 'merge',
      detail: { self_merge: true, reason: 'authors_unavailable' },
    })
    assert.equal(open.ok, true)
  })

  it('allows known browse keys', () => {
    const r = validateAuditDetail({
      action: 'audit.browse',
      detail: { rows: 3, has_more: false, filters: { namespace: 'ns' } },
    })
    assert.equal(r.ok, true)
  })

  it('rejects secrets in reason', () => {
    const r = validateAuditDetail({
      action: 'merge',
      reason: 'fix with mice_pat_AB12CD34EF56GH78',
    })
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.rejection.code, 'audit_secret_detected')
  })

  it('rejects secrets nested in detail', () => {
    const r = validateAuditDetail({
      action: 'audit.export',
      detail: { rows: 1, filters: { note: 'token=Bearer abcdefghijklmnop' } },
    })
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.rejection.code, 'audit_secret_detected')
  })
})
