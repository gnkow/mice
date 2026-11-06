import { mutationNeedsReason } from './auditReason.js'
import { readNamespace } from './authzRepository.js'

/** Carries the QMS change-control id on mutations that require one. */
export const CHANGE_CONTROL_HEADER = 'x-mice-change-control-id'

/**
 * Default per-namespace pattern when none is configured.
 * Alphanumeric start, then letters/digits/._/- , length 3–128.
 */
export const DEFAULT_CHANGE_CONTROL_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._/-]{2,127}$'

export type ChangeControlRejection = {
  code: 'change_control_required' | 'change_control_invalid'
  detail: string
}

/** Same mutation classes as the reason policy (creates never need a change-control id). */
export function mutationNeedsChangeControl(action: string): boolean {
  return mutationNeedsReason(action)
}

export function matchesChangeControlPattern(id: string, pattern: string): boolean {
  const value = id.trim()
  if (!value) return false
  try {
    const re = new RegExp(pattern)
    const m = value.match(re)
    return m != null && m[0] === value
  } catch {
    return false
  }
}

/**
 * Validate a change-control id against the namespace (or default) pattern.
 * When `required` is false, a missing id is accepted as undefined.
 */
export function resolveChangeControl(input: {
  id?: string | null
  pattern: string
  required: boolean
}): { ok: true; value: string | undefined } | { ok: false; rejection: ChangeControlRejection } {
  const raw = (input.id ?? '').trim()
  if (!input.required) {
    if (!raw) return { ok: true, value: undefined }
    if (!matchesChangeControlPattern(raw, input.pattern)) {
      return {
        ok: false,
        rejection: {
          code: 'change_control_invalid',
          detail: `Change-control id does not match the required pattern: ${input.pattern}`,
        },
      }
    }
    return { ok: true, value: raw }
  }
  if (!raw) {
    return {
      ok: false,
      rejection: {
        code: 'change_control_required',
        detail: `A change-control id matching ${input.pattern} is required: send it in the X-Mice-Change-Control-Id header`,
      },
    }
  }
  if (!matchesChangeControlPattern(raw, input.pattern)) {
    return {
      ok: false,
      rejection: {
        code: 'change_control_invalid',
        detail: `Change-control id does not match the required pattern: ${input.pattern}`,
      },
    }
  }
  return { ok: true, value: raw }
}

/** Reject a stored pattern that is not a usable RegExp or is empty. */
export function validateChangeControlPattern(pattern: string): { ok: true; pattern: string } | { ok: false; error: string } {
  const p = pattern.trim()
  if (!p) return { ok: false, error: 'change-control id pattern is required' }
  if (p.length > 256) return { ok: false, error: 'change-control id pattern is too long' }
  try {
    // eslint-disable-next-line no-new
    new RegExp(p)
  } catch {
    return { ok: false, error: 'change-control id pattern is not a valid regular expression' }
  }
  return { ok: true, pattern: p }
}

/** Namespace pattern, or the default when the namespace is missing / has none. */
export async function changeControlPatternFor(namespace?: string | null): Promise<string> {
  const name = namespace?.trim()
  if (!name) return DEFAULT_CHANGE_CONTROL_PATTERN
  const settings = await readNamespace(name)
  return settings?.changeControlIdPattern || DEFAULT_CHANGE_CONTROL_PATTERN
}
