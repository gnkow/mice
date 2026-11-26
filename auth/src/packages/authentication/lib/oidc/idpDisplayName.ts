/**
 * IdP display name (Ticket 32, T8).
 *
 * Display name comes from the IdP directory record (first + last), never from
 * preferred_username, email, or sub. Callers refuse login / authenticated
 * requests when the composed name is empty.
 */

export const EMPTY_IDP_DISPLAY_NAME =
  'Your account has no name in the identity provider.'

/** Join trimmed IdP given/family name parts; empty when the IdP has none. */
export function composeIdpDisplayName(parts: {
  firstName?: string | null
  lastName?: string | null
}): string {
  return [parts.firstName, parts.lastName]
    .map((part) => part?.trim() ?? '')
    .filter(Boolean)
    .join(' ')
}

/** True when the IdP supplied a non-blank display name. */
export function hasIdpDisplayName(name: string): boolean {
  return name.trim().length > 0
}

export type IdpDisplayNameGate =
  | { ok: true }
  | { ok: false; status: 403; error: typeof EMPTY_IDP_DISPLAY_NAME }

/**
 * In-process gate for login and authenticated-request seams: refuse when the
 * IdP display name is blank. Owns the 403 copy so callers stay thin adapters.
 */
export function decideIdpDisplayNameGate(name: string): IdpDisplayNameGate {
  if (hasIdpDisplayName(name)) return { ok: true }
  return { ok: false, status: 403, error: EMPTY_IDP_DISPLAY_NAME }
}
