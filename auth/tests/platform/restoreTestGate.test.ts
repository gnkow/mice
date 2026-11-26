import '../../../db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { isolatedAuth } from '../../src/packages/shared/lib/testSupport.js'

const t = isolatedAuth()
after(() => t.restore())

const {
  decideRestoreTestGate,
  loadRestoreTestStatus,
  recordRestoreTestPassed,
  resetRestoreTestGate,
  restoreTestStatus,
  simulateRestoreTestProcessRestart,
  RESTORE_TEST_REQUIRED,
} = await import('../../src/packages/platform/index.js')
const { queryAudit } = await import('../../src/packages/audit/lib/audit.js')

describe('restore test gate (gxp/15)', () => {
  it('GXP-R-063 refuses regulated actions until a restore test has passed', async () => {
    resetRestoreTestGate()
    assert.equal(decideRestoreTestGate().allow, false)
    assert.equal(decideRestoreTestGate().detail, RESTORE_TEST_REQUIRED)
    assert.equal(restoreTestStatus().passed, false)

    const before = await queryAudit({ action: 'system.restore_test.passed', limit: 50 })
    const recorded = await recordRestoreTestPassed({ recordedBy: 'ops' })
    assert.equal(recorded.passed, true)
    assert.equal(decideRestoreTestGate().allow, true)

    // Gate state is durable in Postgres — recording a pass does not write the ledger.
    const after = await queryAudit({ action: 'system.restore_test.passed', limit: 50 })
    assert.equal(after.events.length, before.events.length)
  })

  it('recovers a prior pass from durable store after process reset', async () => {
    resetRestoreTestGate()
    await recordRestoreTestPassed({ recordedBy: 'ops-persist' })
    simulateRestoreTestProcessRestart()
    assert.equal(restoreTestStatus().passed, false)

    const loaded = await loadRestoreTestStatus()
    assert.equal(loaded.passed, true)
    assert.equal(loaded.recordedBy, 'ops-persist')
    assert.equal(decideRestoreTestGate(loaded).allow, true)
  })
})
