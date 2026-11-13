/** One signature line as shown to reviewers: name at signing, optional current name. */
export type SignatureNameDisplay = {
  signedLine: string
  currently?: string
}

/** One Principal name-history row as shown on the admin timeline (Ticket 47). */
export type NameHistoryRowDisplay = {
  name: string
  fromDay: string
  toDay: string
}

/**
 * Display decision for a signature's printed name.
 * The signed snapshot stays primary; a different current name is a side note.
 */
export function decideSignatureNameDisplay(
  signature: { name: string; signedAt: number },
  currentName?: string,
): SignatureNameDisplay {
  const date = new Date(signature.signedAt).toISOString().slice(0, 10)
  const signedLine = `Signed by: ${signature.name} (${date})`
  if (currentName && currentName !== signature.name) return { signedLine, currently: currentName }
  return { signedLine }
}

/** Access-review string form of {@link decideSignatureNameDisplay}. */
export function shownSignature(
  signature: { name: string; signedAt: number },
  currentName?: string,
): string {
  const { signedLine, currently } = decideSignatureNameDisplay(signature, currentName)
  return currently ? `${signedLine} (currently: ${currently})` : signedLine
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
  }
}
