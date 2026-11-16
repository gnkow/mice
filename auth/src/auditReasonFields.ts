/**
 * Reason / change-control / signature fields that travel Intent → Outcome.
 * Built once for the Intent, then carried onto every linked Outcome.
 */
export type TrackedReason = {
  reason?: string
  reason_source?: 'explicit' | 'commit-message'
  category?: string
  change_control_id?: string
  signature_id?: string
}

export type ReasonFieldSource = {
  reason: string
  reason_source: 'explicit' | 'commit-message'
  category?: string
}

const trimId = (v: string | undefined): string | undefined => {
  const t = (v ?? '').trim()
  return t || undefined
}

/**
 * Normalize reason + change-control + signature for an Intent (and for Outcome carry).
 * Empty / whitespace-only ids are dropped; reason bag is only present when free text is set.
 */
export function intentReasonFields(input: {
  reason?: ReasonFieldSource | null
  changeControlId?: string | null
  signatureId?: string | null
}): TrackedReason {
  const change_control_id = trimId(input.changeControlId ?? undefined)
  const signature_id = trimId(input.signatureId ?? undefined)
  const reason = input.reason
  return {
    ...(reason?.reason
      ? {
          reason: reason.reason,
          reason_source: reason.reason_source,
          ...(reason.category ? { category: reason.category } : {}),
        }
      : {}),
    ...(change_control_id ? { change_control_id } : {}),
    ...(signature_id ? { signature_id } : {}),
  }
}

type ReasonCarrySource = {
  reason?: string
  reason_source?: 'explicit' | 'commit-message'
  category?: string
  change_control_id?: string
  signature_id?: string
}

/** Fields from an Intent that must appear on its Outcome (reason / change-control / signature). */
export function carryFromIntent(intent: ReasonCarrySource): TrackedReason | undefined {
  if (!intent.reason && !intent.change_control_id && !intent.signature_id) return undefined
  const carried = intentReasonFields({
    reason: intent.reason
      ? {
          reason: intent.reason,
          reason_source: intent.reason_source ?? 'explicit',
          ...(intent.category ? { category: intent.category } : {}),
        }
      : null,
    changeControlId: intent.change_control_id,
    signatureId: intent.signature_id,
  })
  return Object.keys(carried).length ? carried : undefined
}
