/** Which addresses a commit view should show. The oxen commit keeps the stored value. */
export type CommitEmailDisplay = {
  /** Address rendered inside `&lt;…&gt;` — the submission-time (stored) email when present. */
  email: string
  source: 'stored' | 'current'
  /** Present when the Principal's current email differs from the commit's stored email. */
  current?: string
}

/**
 * Display decision for a commit author email.
 * Stored email stays primary (matches the oxen commit); a different current email is a side note.
 */
export function decideCommitEmailDisplay(
  stored: string | undefined,
  current: string | undefined,
): CommitEmailDisplay | undefined {
  const storedTrim = stored?.trim() || undefined
  const currentTrim = current?.trim() || undefined
  if (storedTrim && currentTrim && currentTrim !== storedTrim) {
    return { email: storedTrim, source: 'stored', current: currentTrim }
  }
  if (storedTrim) return { email: storedTrim, source: 'stored' }
  if (currentTrim) return { email: currentTrim, source: 'current' }
  return undefined
}

/** String form of {@link decideCommitEmailDisplay} for mono `&lt;email&gt;` rendering. */
export function shownCommitEmail(stored: string | undefined, current: string | undefined): string | undefined {
  return decideCommitEmailDisplay(stored, current)?.email
}

export async function fetchCurrentEmails(authors: string[], signal?: AbortSignal): Promise<Record<string, string>> {
  const unique = [...new Set(authors.map((a) => a.trim()).filter(Boolean))]
  if (unique.length === 0) return {}
  const res = await fetch('/auth/principals/emails', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authors: unique }),
    signal,
  })
  if (!res.ok) return {}
  const data = (await res.json()) as { emails?: Record<string, string> }
  return data.emails ?? {}
}
