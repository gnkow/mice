import { TriangleAlert as ActionTriangleAlert } from 'lucide-react'
import { Link } from 'react-router-dom'
import { hasQcInvalid, type QcInvalidSummary } from '../lib/commitQc'

type Props = {
  namespace: string
  repo: string
  summary: QcInvalidSummary
  /** What the commits belong to, e.g. "this history" or "the commits to merge". */
  scope: string
  /** Extra sentence for views where proceeding is risky (merge). */
  advice?: string
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

/** Non-blocking GxP warning when commits are Invalid or descend from one (ADR 0009). */
export function QcInvalidWarning({ namespace, repo, summary, scope, advice }: Props) {
  if (!hasQcInvalid(summary)) return null
  const base = `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}`
  return (
    <div
      className="flash flash-warn qc-invalid-warning"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="qc-invalid-warning"
    >
      <p>
        <ActionTriangleAlert size={16} aria-hidden="true" className="button-label-icon" />
        <strong>QC Invalid:</strong>{' '}
        {summary.invalid.length > 0
          ? `${count(summary.invalid.length, 'commit')} in ${scope} ${summary.invalid.length === 1 ? 'is' : 'are'} Invalid.`
          : null}
        {summary.descendants.length > 0
          ? ` ${count(summary.descendants.length, 'later commit')} in ${scope} ${summary.descendants.length === 1 ? 'descends' : 'descend'} from an Invalid commit.`
          : null}
        {advice ? ` ${advice}` : null}
      </p>
      {summary.invalid.length > 0 ? (
        <p className="muted small">
          Invalid:{' '}
          {summary.invalid.slice(0, 5).map((id, i) => (
            <span key={id}>
              {i > 0 ? ', ' : null}
              <Link className="mono" to={`${base}/commits/${encodeURIComponent(id)}`}>
                {id.slice(0, 8)}
              </Link>
            </span>
          ))}
          {summary.invalid.length > 5 ? ` and ${summary.invalid.length - 5} more` : null}
        </p>
      ) : null}
    </div>
  )
}

/** @deprecated Prefer QcInvalidWarning. */
export const QcFailedWarning = QcInvalidWarning
