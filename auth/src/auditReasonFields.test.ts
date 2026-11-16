import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { carryFromIntent, intentReasonFields } from './auditReasonFields.js'

describe('intentReasonFields', () => {
  it('builds Intent payload from reason, change-control and signature', () => {
    assert.deepEqual(
      intentReasonFields({
        reason: {
          reason: 'Corrected assay layout after DEV-12',
          reason_source: 'explicit',
          category: 'data_correction',
        },
        changeControlId: 'CC-20261113-aabbccdd',
        signatureId: 'sig-1',
      }),
      {
        reason: 'Corrected assay layout after DEV-12',
        reason_source: 'explicit',
        category: 'data_correction',
        change_control_id: 'CC-20261113-aabbccdd',
        signature_id: 'sig-1',
      },
    )
  })

  it('drops blank change-control and signature ids', () => {
    assert.deepEqual(
      intentReasonFields({
        reason: { reason: 'Routine settings change', reason_source: 'explicit', category: 'privileged_settings' },
        changeControlId: '  ',
        signatureId: '',
      }),
      {
        reason: 'Routine settings change',
        reason_source: 'explicit',
        category: 'privileged_settings',
      },
    )
  })

  it('allows CC/signature without a free-text reason', () => {
    assert.deepEqual(
      intentReasonFields({ changeControlId: 'CC-1', signatureId: 'sig-9' }),
      { change_control_id: 'CC-1', signature_id: 'sig-9' },
    )
  })
})

describe('carryFromIntent', () => {
  it('copies reason, change-control and signature onto the Outcome carry bag', () => {
    assert.deepEqual(
      carryFromIntent({
        reason: 'Corrected assay layout after DEV-12',
        reason_source: 'explicit',
        category: 'data_correction',
        change_control_id: 'CC-20261113-aabbccdd',
        signature_id: 'sig-1',
      }),
      {
        reason: 'Corrected assay layout after DEV-12',
        reason_source: 'explicit',
        category: 'data_correction',
        change_control_id: 'CC-20261113-aabbccdd',
        signature_id: 'sig-1',
      },
    )
  })

  it('returns undefined when Intent has no reason/CC/signature', () => {
    assert.equal(carryFromIntent({}), undefined)
  })

  it('carries change-control alone', () => {
    assert.deepEqual(carryFromIntent({ change_control_id: 'CC-9' }), {
      change_control_id: 'CC-9',
    })
  })
})
