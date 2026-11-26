import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { knownAuditActions } from '../../src/packages/audit/lib/auditLabels.js'
import {
  assertTrailCatalogComplete,
  auditTrailCatalog,
  auditTrailEntry,
  defaultAuditorHiddenFromCatalog,
  TRAIL_OMIT_PRODUCERS,
} from '../../src/packages/audit/lib/auditTrailCatalog.js'
import { defaultAuditorHiddenActions } from '../../src/packages/audit/lib/auditVisibility.js'

describe('auditTrailCatalog (#154)', () => {
  it('covers every known audit action with a trail + auditor default', () => {
    assert.doesNotThrow(() => assertTrailCatalogComplete())
  })

  it('keeps auth.login / logout / session and audit.browse on the ledger but hidden by default', () => {
    for (const action of ['auth.login', 'auth.logout', 'session.create', 'audit.browse']) {
      const row = auditTrailEntry(action)!
      assert.ok(row.trail === 'always' || row.trail === 'summary', action)
      assert.equal(row.auditor, 'hide', action)
    }
    assert.equal(auditTrailEntry('audit.browse')!.trail, 'summary')
  })

  it('documents producer-side omit (bootstrap / seed) without dropping mutation fail-closed', () => {
    assert.ok(TRAIL_OMIT_PRODUCERS.some((p) => /bootstrap/i.test(p.name)))
    assert.ok(TRAIL_OMIT_PRODUCERS.some((p) => /restore-test/i.test(p.name)))
    assert.equal(auditTrailEntry('file.write')!.trail, 'always')
    assert.equal(auditTrailEntry('file.write')!.auditor, 'show')
  })

  it('drives Auditor visibility defaults from the trail catalog', () => {
    const fromCatalog = defaultAuditorHiddenFromCatalog()
    assert.deepEqual(defaultAuditorHiddenActions(), fromCatalog)
    assert.ok(fromCatalog.includes('auth.login'))
    assert.ok(fromCatalog.includes('audit.browse'))
    assert.ok(!fromCatalog.includes('merge'))
    const known = new Set(knownAuditActions().map((a) => a.value))
    for (const a of fromCatalog) assert.ok(known.has(a), a)
  })

  it('lists a rationale on every entry', () => {
    for (const row of auditTrailCatalog()) {
      assert.ok(row.why.trim().length > 0, row.action)
    }
  })
})
