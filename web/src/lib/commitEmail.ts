/** The email a commit view shows. The commit itself keeps the submission-time address. */
export function shownCommitEmail(stored: string | undefined, current: string | undefined): string | undefined {
  if (current && current !== stored) return current
  return stored || undefined
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

