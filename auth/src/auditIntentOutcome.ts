import { carryFromIntent, type TrackedReason } from './auditReasonFields.js'

export { carryFromIntent, type TrackedReason } from './auditReasonFields.js'

/** Minimal event shape for Intent↔Outcome tracking and orphan detection. */
export type IntentOutcomeEvent = {
  id: string
  phase?: 'intent' | 'outcome'
  intent_id?: string
  reason?: string
  reason_source?: 'explicit' | 'commit-message'
  category?: string
  change_control_id?: string
  signature_id?: string
}

type Tracked = {
  id: string
  outcomes: number
  reason?: TrackedReason
}

/** Ledger write ports the tracker needs — injected so this module stays free of the full audit surface. */
export type IntentOutcomeStore<TEvent extends IntentOutcomeEvent, TInput> = {
  appendIntent(partial: TInput): Promise<TEvent>
  appendOutcome(intentId: string, partial: TInput): Promise<TEvent | null>
  appendAudit(partial: TInput): Promise<TEvent | null>
}

/**
 * Request-scoped Intent↔Outcome linkage: remember the Intent written for a request,
 * carry reason fields onto Outcomes, and detect orphans.
 */
export type AuditIntentOutcome<TEvent extends IntentOutcomeEvent, TInput> = {
  trackIntent(request: object, intent: TEvent): void
  beginTrackedIntent(request: object, partial: TInput): Promise<TEvent>
  appendOutcomeFor(request: object, partial: TInput): Promise<TEvent | null>
  trackedIntent(request: object): { id: string; outcomes: number } | undefined
}

/** Deep module for Intent→effect→Outcome tracking (US4). Unit-testable with a fake store. */
export function createAuditIntentOutcome<TEvent extends IntentOutcomeEvent, TInput>(
  store: IntentOutcomeStore<TEvent, TInput>,
): AuditIntentOutcome<TEvent, TInput> {
  const intents = new WeakMap<object, Tracked>()

  function trackIntent(request: object, intent: TEvent): void {
    const reason = carryFromIntent(intent)
    intents.set(request, {
      id: intent.id,
      outcomes: 0,
      ...(reason ? { reason } : {}),
    })
  }

  async function beginTrackedIntent(request: object, partial: TInput): Promise<TEvent> {
    const intent = await store.appendIntent(partial)
    trackIntent(request, intent)
    return intent
  }

  function appendOutcomeFor(request: object, partial: TInput): Promise<TEvent | null> {
    const tracked = intents.get(request)
    if (!tracked) return store.appendAudit(partial)
    tracked.outcomes += 1
    return store.appendOutcome(tracked.id, { ...tracked.reason, ...partial } as TInput)
  }

  function trackedIntent(request: object): { id: string; outcomes: number } | undefined {
    return intents.get(request)
  }

  return { trackIntent, beginTrackedIntent, appendOutcomeFor, trackedIntent }
}

/** Intents with no matching Outcome — detectable orphans (ticket 12 reconciler is wontfix). */
export function orphanIntents<E extends IntentOutcomeEvent>(events: E[]): E[] {
  const resolved = new Set(
    events.flatMap((e) => (e.phase === 'outcome' && e.intent_id ? [e.intent_id] : [])),
  )
  return events.filter((e) => e.phase === 'intent' && !resolved.has(e.id))
}
