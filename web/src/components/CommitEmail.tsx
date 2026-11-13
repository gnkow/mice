import { useAsync } from '../hooks/useAsync'
import { decideCommitEmailDisplay, fetchCurrentEmails } from '../lib/commitEmail'

export function useCurrentEmails(authors: string[]): Record<string, string> {
  const key = [...new Set(authors.map((a) => a.trim()).filter(Boolean))].sort().join('\n')
  const state = useAsync(
    (signal) => fetchCurrentEmails(key ? key.split('\n') : [], signal),
    [key],
  )
  return state.kind === 'ok' ? state.data : {}
}

export function CommitEmail({
  author,
  stored,
  emails,
  separator = false,
}: {
  author: string
  stored?: string | null
  emails?: Record<string, string>
  separator?: boolean
}) {
  const fetched = useCurrentEmails(emails ? [] : author ? [author] : [])
  const shown = decideCommitEmailDisplay(stored ?? undefined, (emails ?? fetched)[author.trim()])
  if (!shown) return null
  return (
    <>
      {separator ? ' · ' : null}
      <span className="mono">&lt;{shown.email}&gt;</span>
    </>
  )
}
