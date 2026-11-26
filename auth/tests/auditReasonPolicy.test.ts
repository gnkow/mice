import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { overrideEnv } from '../src/packages/shared/lib/env.js'
import {
  createExemptActions,
  mutationNeedsReason,
  resolveReason,
} from '../src/packages/audit/lib/auditReason.js'

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
    assert.deepEqual(createExemptActions(), [
      'branch.create',
      'file.write',
      'namespace.create',
      'repo.create',
    ])
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

await describe('resolveReason free text', async () => {
  const actor = { iss: 'https://idp.test', sub: 'reason-policy' }

  await it('rejects a missing reason', () => {
    const resolved = resolveReason({ actor })
    assert.equal(resolved.ok, false)
    if (!resolved.ok) assert.equal(resolved.rejection.code, 'reason_required')
  })

  await it('rejects a reason that is too short', () => {
    const restore = overrideEnv({ auditReasonMinLength: 10 })
    try {
      const resolved = resolveReason({ actor, explicit: 'short' })
      assert.equal(resolved.ok, false)
      if (!resolved.ok) assert.equal(resolved.rejection.code, 'reason_too_short')
    } finally {
      restore()
    }
  })

  await it('accepts long-enough free text', () => {
    const resolved = resolveReason({
      actor,
      explicit: 'Instrument recalibrated for assay batch 12',
    })
    assert.equal(resolved.ok, true)
    if (resolved.ok) {
      assert.equal(resolved.value.reason, 'Instrument recalibrated for assay batch 12')
      assert.equal(resolved.value.reason_source, 'explicit')
    }
  })
})
