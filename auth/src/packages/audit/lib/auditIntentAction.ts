/**
 * Actions that must never be written as an Intent, under any condition.
 *
 * `bff.mutation` was a placeholder for "a guarded route did not say what it does". An Intent that
 * does not name its operation is a bug in the route, not something to paper over: it fails loudly.
 * Historic ledger rows may still carry it; they stay visible and labelled, nothing new writes it.
 */
export const FORBIDDEN_INTENT_ACTIONS: readonly string[] = ['bff.mutation']

/** An Intent was about to be written without a concrete operation name. Always a bug in the caller. */
export class IntentActionError extends Error {
  readonly code = 'intent_action_invalid' as const
  constructor(message: string) {
    super(message)
    this.name = 'IntentActionError'
  }
}

/**
 * Returns the trimmed action, or throws {@link IntentActionError} when it is missing, blank or
 * forbidden. `where` names the caller (route or writer) so the failure is easy to find.
 */
export function assertIntentAction(action: unknown, where = 'Intent'): string {
  if (typeof action !== 'string' || action.trim() === '') {
    throw new IntentActionError(`${where}: an Intent must name its operation (action is missing)`)
  }
  const trimmed = action.trim()
  if (FORBIDDEN_INTENT_ACTIONS.includes(trimmed)) {
    throw new IntentActionError(`${where}: "${trimmed}" must never be written as an Intent action; name the real operation`)
  }
  return trimmed
}
