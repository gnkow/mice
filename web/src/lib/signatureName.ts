/** One signature line as shown to reviewers: name at signing, optional current name. */
export type SignatureNameDisplay = {
  signedLine: string
  /** Present when the Principal's stored current name differs from the signed snapshot. */
  nowKnownAs?: string
}

/** One Principal name-history row as shown on the admin timeline (Ticket 47). */
export type NameHistoryRowDisplay = {
  name: string
  fromDay: string
  toDay: string
  /** True when this interval is still open (validTo is null). */
  isCurrent: boolean
}

/**
 * Display decision for a signature's printed name.
 * The signed snapshot stays primary; a different current name is a "now known as" note.
 */
export function decideSignatureNameDisplay(
  signature: { name: string; signedAt: number },
  currentName?: string,
): SignatureNameDisplay {
  const date = new Date(signature.signedAt).toISOString().slice(0, 10)
  const signedLine = `Signed by: ${signature.name} (${date})`
  if (currentName && currentName !== signature.name) return { signedLine, nowKnownAs: currentName }
  return { signedLine }
}

/** Access-review string form of {@link decideSignatureNameDisplay}. */
export function shownSignature(
  signature: { name: string; signedAt: number },
  currentName?: string,
): string {
  const { signedLine, nowKnownAs } = decideSignatureNameDisplay(signature, currentName)
  return nowKnownAs ? `${signedLine} (now known as: ${nowKnownAs})` : signedLine
}

/** Calendar-day label for a Principal name-history bound; open end is "current". */
export function nameHistoryDayLabel(iso: string | null): string {
  return iso ? iso.slice(0, 10) : 'current'
}

/**
 * Display decision for one stored name-history interval (no IdP).
 * Callers render; this owns day-bound labeling for the admin timeline.
 */
export function decideNameHistoryRowDisplay(row: {
  name: string
  validFrom: string
  validTo: string | null
}): NameHistoryRowDisplay {
  return {
    name: row.name,
    fromDay: nameHistoryDayLabel(row.validFrom),
    toDay: nameHistoryDayLabel(row.validTo),
    isCurrent: row.validTo === null,
  }
}
