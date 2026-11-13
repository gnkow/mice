/** Which address a commit view should show. The oxen commit keeps the stored value. */
export type CommitEmailDisplay = {
  email: string
  source: 'stored' | 'current'
}

/**
 * Display decision for a commit author email.
 * Prefer the Principal's current email when it differs; otherwise the submission-time address.
 */
export function decideCommitEmailDisplay(
  stored: string | undefined,
  current: string | undefined,
): CommitEmailDisplay | undefined {
  if (current && current !== stored) return { email: current, source: 'current' }
  if (stored) return { email: stored, source: 'stored' }
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
