import { AuditChangeCaptureError } from './auditChange.js'

/**
 * Fail-closed before-state read: any failure becomes {@link AuditChangeCaptureError} so the
 * caller refuses the mutation instead of writing an audit event without a real `change`.
 */
export async function captureBefore<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read()
  } catch (err) {
    throw new AuditChangeCaptureError(
      `Could not capture state before mutation: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

/** Copies only the listed keys (missing → null) so snapshots stay stable and secret-free. */
export function pickSnapshot<T extends object>(
  source: T | null | undefined,
  keys: readonly (keyof T & string)[],
): Record<string, unknown> | null {
  if (!source) return null
  const out: Record<string, unknown> = {}
  for (const k of keys) out[k] = source[k] ?? null
  return out
}
