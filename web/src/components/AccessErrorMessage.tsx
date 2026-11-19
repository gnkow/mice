import { describeAccessError, formatAccessError } from '../lib/accessError'

type Props = {
  error: string
  /** What the user was trying to do, e.g. "view data". */
  purpose?: string
  /** Tighter layout for narrow panels (e.g. repo aside). */
  compact?: boolean
}

/** Title + guidance for AuthZ denials; falls back to plain text for other errors. */
export function AccessErrorMessage({ error, purpose, compact }: Props) {
  const view = describeAccessError(error, { purpose })
  if (!view) {
    return <p className="error">{formatAccessError(error, { purpose })}</p>
  }
  return (
    <div className={`access-error${compact ? ' is-compact' : ''}`}>
      <p className="access-error-title">{view.title}</p>
      <p className="access-error-detail">{view.detail}</p>
    </div>
  )
}
