import { Link, useParams } from 'react-router-dom'
import { ApproverVersionSeats, VersionHistoryList } from '../components/VersionHistory'
import { useAsync } from '../hooks/useAsync'
import { fetchApproverHistory } from '../lib/authzApi'

/** Approver-set history under `/n/:namespace/r/:repo/settings/approvers/history`. */
export function RepoApproverHistoryPage() {
  const { namespace = '', repo = '' } = useParams()
  const base = `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}`
  const settingsHref = `${base}/settings#repo-approvers`
  const state = useAsync(
    (signal) => fetchApproverHistory({ ns: namespace, repo }, signal),
    [namespace, repo],
  )

  return (
    <main className="page wide">
      <div className="page-head">
        <div>
          <p className="crumb">
            <Link to={base}>{repo}</Link>
            <span aria-hidden> / </span>
            <Link to={`${base}/settings`}>Settings</Link>
            <span aria-hidden> / </span>
            <span>Approver history</span>
          </p>
          <h1>Approver history</h1>
          <p className="lede">
            Successive approver sets for{' '}
            <code>
              {namespace}/{repo}
            </code>
            . Distinct from the Audit trail (who / why).
          </p>
        </div>
      </div>
      <section
        className="settings-section"
        aria-labelledby="repo-approver-history-heading"
        data-testid="approver-history"
      >
        <h2 id="repo-approver-history-heading" className="visually-hidden">
          Versions
        </h2>
        <VersionHistoryList
          state={state}
          label="Approver versions"
          emptyMessage="No versions recorded yet."
          emptyAction={
            <Link className="btn ghost small" to={settingsHref}>
              Manage Approvers
            </Link>
          }
          renderBody={(v) => <ApproverVersionSeats approvers={v.approvers} />}
        />
      </section>
    </main>
  )
}
