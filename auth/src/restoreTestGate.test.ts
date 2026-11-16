import './db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { isolatedAuth } from './testSupport.js'

const t = isolatedAuth()
after(() => t.restore())

const {
  decideRestoreTestGate,
  recordRestoreTestPassed,
  resetRestoreTestGate,
  restoreTestStatus,
  RESTORE_TEST_REQUIRED,
} = await import('./restoreTestGate.js')
const { queryAudit } = await import('./audit.js')

describe('restore test gate (gxp/15)', () => {
  it('GXP-R-063 refuses regulated actions until a restore test has passed', async () => {
    resetRestoreTestGate()
    assert.equal(decideRestoreTestGate().allow, false)
    assert.equal(decideRestoreTestGate().detail, RESTORE_TEST_REQUIRED)
    assert.equal(restoreTestStatus().passed, false)

    const recorded = await recordRestoreTestPassed({ recordedBy: 'ops' })
    assert.equal(recorded.passed, true)
    assert.equal(decideRestoreTestGate().allow, true)

    const { events } = await queryAudit({ action: 'system.restore_test.passed', limit: 5 })
    assert.ok(events.some((e) => e.action === 'system.restore_test.passed'))
  })
})
