/** JSON HTTP outcome from a namespace use-case (routes map this to c.json). */
export type JsonOutcome = {
  status: number
  body: unknown
}

/** Deny/redirect response already built by the route adapter helpers. */
export type HttpOutcome = JsonOutcome | { response: Response }

export function json(status: number, body: unknown): JsonOutcome {
  return { status, body }
}

export function isResponse(outcome: HttpOutcome): outcome is { response: Response } {
  return 'response' in outcome
}
