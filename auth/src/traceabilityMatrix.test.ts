import './db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  GXP_REQUIREMENT_CATALOG,
  buildTraceabilityMatrixFromTestNames,
  extractGxpRequirementIds,
  recordTraceabilityMatrixRelease,
} from './traceabilityMatrix.js'

describe('traceability matrix (GxP ticket 18)', () => {
  it('extracts GXP-R requirement ids from a test name', () => {
    assert.deepEqual(
      extractGxpRequirementIds('GXP-R-013 refuses mutation without reason category'),
      ['GXP-R-013'],
    )
    assert.deepEqual(
      extractGxpRequirementIds('GXP-R-061 and GXP-R-063 backup restore start gates'),
      ['GXP-R-061', 'GXP-R-063'],
    )
    assert.deepEqual(extractGxpRequirementIds('plain test without tags'), [])
  })

  it('builds a matrix from tagged test names with catalog descriptions', () => {
    const matrix = buildTraceabilityMatrixFromTestNames([
      'GXP-R-013 refuses mutation without reason category',
      'GXP-R-013 accepts regulated mutation with ceremony',
      'GXP-R-008 signature record is append-only in immudb',
      'untagged helper',
    ])
    assert.ok(matrix.generatedAt > 0)
    const byId = Object.fromEntries(matrix.mappings.map((m) => [m.requirementId, m]))
    assert.deepEqual(byId['GXP-R-013']?.testCases, [
      'GXP-R-013 refuses mutation without reason category',
      'GXP-R-013 accepts regulated mutation with ceremony',
    ])
    assert.equal(
      byId['GXP-R-013']?.requirementDescription,
      GXP_REQUIREMENT_CATALOG['GXP-R-013'],
    )
    assert.equal(byId['GXP-R-008']?.testCases.length, 1)
    assert.equal(matrix.coverage.coveredRequirements, 2)
    assert.ok(matrix.coverage.totalRequirements >= 2)
  })

  it('records the matrix digest on the release audit trail', async () => {
    const { isolatedAuth } = await import('./testSupport.js')
    const { queryAudit } = await import('./audit.js')
    const t = isolatedAuth()
    try {
      const matrix = buildTraceabilityMatrixFromTestNames([
        'GXP-R-026 electronic signature on regulated mutations',
      ])
      const recorded = await recordTraceabilityMatrixRelease(matrix)
      assert.ok(recorded.digest.startsWith('sha256:'))
      const { events } = await queryAudit({ action: 'system.traceability_matrix.release', limit: 20 })
      const hit = events.find(
        (e) =>
          e.action === 'system.traceability_matrix.release' &&
          (e.detail as { digest?: string } | undefined)?.digest === recorded.digest,
      )
      assert.ok(hit, 'expected audit event for release matrix')
    } finally {
      t.restore()
    }
  })
})
