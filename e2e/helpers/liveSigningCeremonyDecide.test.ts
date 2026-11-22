import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  decideLiveSigningCeremony,
  initialCeremonyBudget,
} from './liveSigningCeremonyDecide.ts'

describe('decideLiveSigningCeremony', () => {
  it('fills reason after trigger, then signs when the sign dialog is ready', () => {
    let budget = initialCeremonyBudget()
    let phase: Parameters<typeof decideLiveSigningCeremony>[0]['phase'] = 'after_trigger'

    let r = decideLiveSigningCeremony({
      phase,
      gate: 'absent',
      dialogLost: false,
      successVisible: false,
      budget,
    })
    assert.equal(r.command.op, 'fill_reason')
    phase = r.phase
    budget = r.budget

    r = decideLiveSigningCeremony({
      phase,
      gate: 'sign',
      dialogLost: false,
      successVisible: false,
      budget,
    })
    assert.equal(r.command.op, 'click_sign')
    assert.equal(r.phase, 'after_sign')
  })

  it('steps up on interstitial then signs', () => {
    const budget = initialCeremonyBudget()
    const step = decideLiveSigningCeremony({
      phase: 'awaiting_gate',
      gate: 'interstitial',
      dialogLost: false,
      successVisible: false,
      budget,
    })
    assert.equal(step.command.op, 'step_up')
    assert.equal(step.budget.stepUpsThisAttempt, 1)

    const after = decideLiveSigningCeremony({
      phase: step.phase,
      gate: 'sign',
      dialogLost: false,
      successVisible: false,
      budget: step.budget,
    })
    assert.equal(after.command.op, 'click_sign')
  })

  it('retriggers when the dialog is lost after step-up', () => {
    const budget = initialCeremonyBudget(2)
    const r = decideLiveSigningCeremony({
      phase: 'after_step_up',
      gate: 'absent',
      dialogLost: true,
      successVisible: false,
      budget,
    })
    assert.equal(r.command.op, 'retrigger')
    assert.equal(r.phase, 'after_trigger')
    assert.equal(r.budget.attemptsLeft, 1)
    assert.equal(r.budget.stepUpsThisAttempt, 0)
  })

  it('steps up again after Sign when execute demands MFA', () => {
    const budget = { ...initialCeremonyBudget(), stepUpsThisAttempt: 1 }
    const r = decideLiveSigningCeremony({
      phase: 'after_sign',
      gate: 'interstitial',
      dialogLost: false,
      successVisible: false,
      budget,
    })
    assert.equal(r.command.op, 'step_up')
    assert.equal(r.phase, 'after_step_up')
    assert.equal(r.budget.stepUpsThisAttempt, 2)
  })

  it('completes when success is visible', () => {
    const r = decideLiveSigningCeremony({
      phase: 'after_sign',
      gate: 'absent',
      dialogLost: false,
      successVisible: true,
      budget: initialCeremonyBudget(),
    })
    assert.equal(r.command.op, 'done')
    assert.equal(r.phase, 'done')
  })

  it('fails when attempts are exhausted', () => {
    const r = decideLiveSigningCeremony({
      phase: 'after_step_up',
      gate: 'absent',
      dialogLost: true,
      successVisible: false,
      budget: initialCeremonyBudget(1),
    })
    assert.equal(r.command.op, 'fail')
  })
})
