import { History as ActionHistory } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { SeatVersionList, VersionHistoryList } from '../components/VersionHistory'
import { useAsync } from '../hooks/useAsync'
import { fetchRepoCollaboratorHistory } from '../lib/authzApi'

/** Collaborator-set history under `/n/:namespace/r/:repo/settings/collaborators/history`. */
export function RepoCollaboratorHistoryPage() {
  const { namespace = '', repo = '' } = useParams()
  const base = `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}`
  const state = useAsync(
    (signal) => fetchRepoCollaboratorHistory(namespace, repo, signal),
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
            <span>Collaborator history</span>
          </p>
          <h1>Collaborator history</h1>
          <p className="lede">
            Successive collaborator sets for{' '}
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
      <section className="settings-section" aria-labelledby="repo-collab-history-heading">
        <h2 id="repo-collab-history-heading">Versions</h2>
        <VersionHistoryList
          state={state}
          label="Collaborator versions"
          emptyMessage="No versions recorded."
          renderBody={(v) => <SeatVersionList seats={v.collaborators} emptyLabel="No collaborators" />}
        />
      </section>
    </main>
  )
}
