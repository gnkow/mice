/**
 * Optional "now known as" note for a signature view.
 * Uses the Principal's stored current name — not a live IdP lookup.
 */
export function decideNowKnownAs(
  signedName: string,
  currentName: string | null | undefined,
): string | undefined {
  if (currentName && currentName !== signedName) return currentName
  return undefined
}
