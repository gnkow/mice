import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { overrideEnv } from './env.js'
import {
  mutationNeedsReason,
  REASON_CATEGORIES,
  resolveReason,
} from './auditReason.js'

await describe('mutationNeedsReason', async () => {
  await it('does not require a reason when creating new resources', () => {
    for (const action of [
      'namespace.create',
      'repo.create',
      'branch.create',
      'file.write', // new data / first write — create-exempt at the policy class level
    ]) {
      assert.equal(mutationNeedsReason(action), false, action)
    }
  })

  await it('requires a reason for updates, deletes, privileged settings, destructive actions and revocation', () => {
    for (const action of [
      'file.delete',
      'branch.update',
      'branch.delete',
      'repo.delete',
      'repo.metadata',
      'namespace.update',
      'merge',
      'commit.publish',
      'workspace.commit',
      'workspace.merge',
      'privileged_settings',
      'revocation',
      'destructive',
    ]) {
      assert.equal(mutationNeedsReason(action), true, action)
    }
  })
})

await describe('resolveReason category + free text', async () => {
  const actor = { iss: 'https://idp.test', sub: 'reason-policy' }

  await it('rejects a required reason with no category', () => {
    const resolved = resolveReason({
      actor,
      explicit: 'Instrument recalibrated for assay batch 12',
      category: undefined,
      required: true,
    })
    assert.equal(resolved.ok, false)
    if (!resolved.ok) assert.equal(resolved.rejection.code, 'reason_category_required')
  })

  await it('rejects an unknown category', () => {
    const resolved = resolveReason({
      actor,
      explicit: 'Instrument recalibrated for assay batch 12',
      category: 'not-a-real-category',
      required: true,
    })
    assert.equal(resolved.ok, false)
    if (!resolved.ok) assert.equal(resolved.rejection.code, 'reason_category_invalid')
  })

  await it('rejects a required reason that is too short even with a valid category', () => {
    const restore = overrideEnv({ auditReasonMinLength: 10 })
    try {
      const resolved = resolveReason({
        actor,
        explicit: 'short',
        category: 'data_correction',
        required: true,
      })
      assert.equal(resolved.ok, false)
      if (!resolved.ok) assert.equal(resolved.rejection.code, 'reason_too_short')
    } finally {
      restore()
    }
  })

  await it('accepts a valid category and long-enough free text', () => {
    const resolved = resolveReason({
      actor,
      explicit: 'Instrument recalibrated for assay batch 12',
      category: 'data_correction',
      required: true,
    })
    assert.equal(resolved.ok, true)
    if (resolved.ok) {
      assert.equal(resolved.value.reason, 'Instrument recalibrated for assay batch 12')
      assert.equal(resolved.value.category, 'data_correction')
      assert.equal(resolved.value.reason_source, 'explicit')
    }
  })

  await it('exposes the fixed v1 pick-list', () => {
    assert.ok(REASON_CATEGORIES.includes('data_correction'))
    assert.ok(REASON_CATEGORIES.includes('destructive'))
    assert.ok(REASON_CATEGORIES.includes('privileged_settings'))
    assert.ok(REASON_CATEGORIES.includes('revocation'))
    assert.ok(REASON_CATEGORIES.includes('other'))
  })
})
