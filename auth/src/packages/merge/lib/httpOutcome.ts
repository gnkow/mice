/** JSON HTTP outcome from a merge use-case (routes map this to c.json). */
export type JsonOutcome = {
  status: number
  body: unknown
}

/** Use-case outcome that may also return a raw Response (e.g. PDF download). */
export type HttpOutcome = JsonOutcome | { raw: Response }

export function json(status: number, body: unknown): JsonOutcome {
  return { status, body }
}

export function isRaw(outcome: HttpOutcome): outcome is { raw: Response } {
  return 'raw' in outcome
}
