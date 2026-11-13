/**
 * IdP display name (Ticket 32, T8).
 *
 * Display name comes from the IdP directory record (first + last), never from
 * preferred_username, email, or sub. Callers refuse login / authenticated
 * requests when the composed name is empty.
 */

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
