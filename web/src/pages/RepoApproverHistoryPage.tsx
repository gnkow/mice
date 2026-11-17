import { History as ActionHistory } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { ApproverVersionSeats, VersionHistoryList } from '../components/VersionHistory'
import { useAsync } from '../hooks/useAsync'
import { fetchApproverHistory } from '../lib/authzApi'

/** Approver-set history under `/n/:namespace/r/:repo/settings/approvers/history`. */
export function RepoApproverHistoryPage() {
  const { namespace = '', repo = '' } = useParams()
  const base = `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}`
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
        <div className="btn-row">
          <Link className="btn ghost" to={`${base}/settings`}>
            <ActionHistory size={14} aria-hidden="true" className="button-label-icon" />
            Back to settings
          </Link>
        </div>
      </div>
      <section className="settings-section" aria-labelledby="repo-approver-history-heading">
        <h2 id="repo-approver-history-heading">Versions</h2>
        <VersionHistoryList
          state={state}
          label="Approver versions"
          emptyMessage="No versions recorded."
          renderBody={(v) => <ApproverVersionSeats approvers={v.approvers} />}
        />
      </section>
    </main>
  )
}
