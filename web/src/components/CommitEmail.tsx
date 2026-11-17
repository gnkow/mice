import { useAsync } from '../hooks/useAsync'
import {
  decideCommitEmailDisplay,
  fetchPrincipalProfiles,
  type PrincipalProfiles,
} from '../lib/commitEmail'

const emptyProfiles: PrincipalProfiles = { emails: {}, names: {} }

export function usePrincipalProfiles(authors: string[]): PrincipalProfiles {
  const key = [...new Set(authors.map((a) => a.trim()).filter(Boolean))]
    .sort()
    .join('\n')
  const state = useAsync(
    (signal) =>
      fetchPrincipalProfiles(key ? key.split('\n') : [], signal),
    [key],
  )
  return state.kind === 'ok' ? state.data : emptyProfiles
}

/** @deprecated Prefer usePrincipalProfiles — kept for call sites that only need emails. */
export function useCurrentEmails(authors: string[]): Record<string, string> {
  return usePrincipalProfiles(authors).emails
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
  const fetched = usePrincipalProfiles(emails ? [] : author ? [author] : [])
  const shown = decideCommitEmailDisplay(
    stored ?? undefined,
    (emails ?? fetched.emails)[author.trim()],
  )
  if (!shown) return null
  return (
    <>
      {separator ? ' · ' : null}
      <span
        className="commit-email"
        data-testid="commit-email"
        data-source={shown.source}
        aria-label={
          shown.current
            ? `Commit email ${shown.email}, current email ${shown.current}`
            : `Commit email ${shown.email}`
        }
      >
        <span className="mono">&lt;{shown.email}&gt;</span>
        {shown.current ? (
          <span className="muted small commit-email-current" data-testid="commit-email-current">
            {' '}
            (current: {shown.current})
          </span>
        ) : null}
      </span>
    </>
  )
}
