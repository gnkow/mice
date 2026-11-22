/**
 * Pure policy for the live MFA signing ceremony loop (Ticket 18 / #83).
 * Playwright owns observation + I/O; this module decides the next command.
 */

export type CeremonyGate = 'interstitial' | 'sign' | 'absent'

export type CeremonyCommand =
  | { op: 'fill_reason' }
  | { op: 'step_up' }
  | { op: 'click_sign' }
  | { op: 'retrigger' }
  | { op: 'done' }
  | { op: 'fail'; reason: string }

export type CeremonyPhase =
  | 'after_trigger'
  | 'awaiting_gate'
  | 'after_step_up'
  | 'ready_to_sign'
  | 'after_sign'
  | 'done'

export type CeremonyBudget = {
  /** Whole trigger→sign attempts remaining (including the current one). */
  attemptsLeft: number
  /** Step-ups consumed while clearing gates in the current attempt. */
  stepUpsThisAttempt: number
  maxStepUpsPerAttempt: number
}

const DEFAULT_MAX_STEP_UPS = 3

export function initialCeremonyBudget(
  attempts = 3,
  maxStepUpsPerAttempt = DEFAULT_MAX_STEP_UPS,
): CeremonyBudget {
  return { attemptsLeft: attempts, stepUpsThisAttempt: 0, maxStepUpsPerAttempt }
}

/**
 * Decide the next ceremony command from phase + UI observation.
 * Locality: gate/retry/step-up policy lives here, not in the Playwright driver.
 */
export function decideLiveSigningCeremony(input: {
  phase: CeremonyPhase
  gate: CeremonyGate
  /** True when neither reason nor sign dialog is visible after a step-up return. */
  dialogLost: boolean
  successVisible: boolean
  budget: CeremonyBudget
}): { command: CeremonyCommand; phase: CeremonyPhase; budget: CeremonyBudget } {
  const { phase, gate, dialogLost, successVisible, budget } = input

  if (successVisible || phase === 'done') {
    return { command: { op: 'done' }, phase: 'done', budget }
  }

  if (budget.attemptsLeft <= 0) {
    return {
      command: { op: 'fail', reason: 'Live signing ceremony exhausted attempts' },
      phase: 'done',
      budget,
    }
  }

  switch (phase) {
    case 'after_trigger':
      return { command: { op: 'fill_reason' }, phase: 'awaiting_gate', budget }

    case 'awaiting_gate':
      if (gate === 'interstitial') {
        if (budget.stepUpsThisAttempt >= budget.maxStepUpsPerAttempt) {
          return {
            command: { op: 'fail', reason: 'Too many step-ups while awaiting sign dialog' },
            phase: 'done',
            budget,
          }
        }
        return {
          command: { op: 'step_up' },
          phase: 'after_step_up',
          budget: { ...budget, stepUpsThisAttempt: budget.stepUpsThisAttempt + 1 },
        }
      }
      if (gate === 'sign') {
        return { command: { op: 'click_sign' }, phase: 'after_sign', budget }
      }
      return {
        command: { op: 'fail', reason: 'Ceremony gate never appeared' },
        phase: 'done',
        budget,
      }

    case 'after_step_up':
      if (dialogLost) {
        const nextAttempts = budget.attemptsLeft - 1
        if (nextAttempts <= 0) {
          return {
            command: { op: 'fail', reason: 'Dialog lost after step-up; no attempts left' },
            phase: 'done',
            budget: { ...budget, attemptsLeft: 0 },
          }
        }
        return {
          command: { op: 'retrigger' },
          phase: 'after_trigger',
          budget: {
            ...budget,
            attemptsLeft: nextAttempts,
            stepUpsThisAttempt: 0,
          },
        }
      }
      if (gate === 'interstitial') {
        return decideLiveSigningCeremony({
          ...input,
          phase: 'awaiting_gate',
        })
      }
      if (gate === 'sign') {
        return { command: { op: 'click_sign' }, phase: 'after_sign', budget }
      }
      return {
        command: { op: 'fail', reason: 'Unexpected UI after step-up' },
        phase: 'done',
        budget,
      }

    case 'ready_to_sign':
      return { command: { op: 'click_sign' }, phase: 'after_sign', budget }

    case 'after_sign':
      if (successVisible) {
        return { command: { op: 'done' }, phase: 'done', budget }
      }
      if (gate === 'interstitial') {
        if (budget.stepUpsThisAttempt >= budget.maxStepUpsPerAttempt) {
          return {
            command: { op: 'fail', reason: 'Too many step-ups after Sign' },
            phase: 'done',
            budget,
          }
        }
        return {
          command: { op: 'step_up' },
          phase: 'after_step_up',
          budget: { ...budget, stepUpsThisAttempt: budget.stepUpsThisAttempt + 1 },
        }
      }
      if (gate === 'sign') {
        return { command: { op: 'click_sign' }, phase: 'after_sign', budget }
      }
      // No success and no gate — retrigger a full attempt.
      {
        const nextAttempts = budget.attemptsLeft - 1
        if (nextAttempts <= 0) {
          return {
            command: { op: 'fail', reason: 'Sign completed without success indicator' },
            phase: 'done',
            budget: { ...budget, attemptsLeft: 0 },
          }
        }
        return {
          command: { op: 'retrigger' },
          phase: 'after_trigger',
          budget: {
            ...budget,
            attemptsLeft: nextAttempts,
            stepUpsThisAttempt: 0,
          },
        }
      }

    default:
      return {
        command: { op: 'fail', reason: `Unknown ceremony phase: ${phase}` },
        phase: 'done',
        budget,
      }
  }
}
