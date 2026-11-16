import { TriangleAlert as ActionTriangleAlert } from 'lucide-react'
import { Link } from 'react-router-dom'
import { hasQcFailures, type QcFailureSummary } from '../lib/commitQc'

type Props = {
  namespace: string
  repo: string
  summary: QcFailureSummary
  /** What the commits belong to, e.g. "this history" or "the commits to merge". */
  scope: string
  /** Extra sentence for views where proceeding is risky (merge). */
  advice?: string
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

/** Non-blocking GxP warning when commits are QC Failed or descend from one (signature revoked). */
export function QcFailedWarning({ namespace, repo, summary, scope, advice }: Props) {
  if (!hasQcFailures(summary)) return null
  const base = `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}`
  return (
    <div className="flash flash-warn qc-failed-warning" role="status" data-testid="qc-failed-warning">
      <p>
        <ActionTriangleAlert size={16} aria-hidden="true" className="button-label-icon" />
        <strong>QC Failed:</strong>{' '}
        {summary.failed.length > 0
          ? `${count(summary.failed.length, 'commit')} in ${scope} ${summary.failed.length === 1 ? 'is' : 'are'} QC Failed because a signature was revoked.`
          : null}
        {summary.descendants.length > 0
          ? ` ${count(summary.descendants.length, 'later commit')} in ${scope} ${summary.descendants.length === 1 ? 'descends' : 'descend'} from a QC Failed commit.`
          : null}
        {advice ? ` ${advice}` : null}
      </p>
      {summary.failed.length > 0 ? (
        <p className="muted small">
          QC Failed:{' '}
          {summary.failed.slice(0, 5).map((id, i) => (
            <span key={id}>
              {i > 0 ? ', ' : null}
              <Link className="mono" to={`${base}/commits/${encodeURIComponent(id)}`}>
                {id.slice(0, 8)}
              </Link>
            </span>
          ))}
          {summary.failed.length > 5 ? ` and ${summary.failed.length - 5} more` : null}
        </p>
      ) : null}
    </div>
  )
}
