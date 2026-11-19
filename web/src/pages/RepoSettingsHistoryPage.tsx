import { History as ActionHistory } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { StateBlock } from '../components/StateBlock'
import { useAsync } from '../hooks/useAsync'
import { fetchRepoSettingsHistory } from '../lib/authzApi'

/** Settings history under `/n/:namespace/r/:repo/settings/history`. */
export function RepoSettingsHistoryPage() {
  const { namespace = '', repo = '' } = useParams()
  const base = `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}`
  const state = useAsync(
    (signal) => fetchRepoSettingsHistory(namespace, repo, signal),
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
            <span>Settings history</span>
          </p>
          <h1>Settings history</h1>
          <p className="lede">
            Successive repository settings (display name and description) for{' '}
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
      <section className="settings-section" aria-labelledby="repo-settings-history-heading">
        <h2 id="repo-settings-history-heading">Versions</h2>
        <StateBlock
          loading={state.kind === 'loading'}
          error={state.kind === 'error' ? state.message : null}
          onRetry={() => state.reload()}
        >
          {state.kind === 'ok' &&
            (state.data.versions.length === 0 ? (
              <p className="muted">No versions recorded.</p>
            ) : (
              <ol className="ns-member-list" style={{ listStyle: 'none', padding: 0 }}>
                {state.data.versions.map((v) => (
                  <li key={`${v.validFrom}-${v.name}`} className="ns-member-row">
                    <div className="ns-member-main">
                      <p>
                        <strong>{v.name}</strong>
                        {v.validTo === null ? <span className="ns-tag"> current</span> : null}
                      </p>
                      {v.description?.trim() ? (
                        <p className="muted small">{v.description.trim()}</p>
                      ) : (
                        <p className="muted small">No description</p>
                      )}
                      <p className="muted small">
                        {new Date(v.validFrom).toLocaleString()}
                        {v.validTo ? ` → ${new Date(v.validTo).toLocaleString()}` : ' → present'}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            ))}
        </StateBlock>
      </section>
    </main>
  )
}
