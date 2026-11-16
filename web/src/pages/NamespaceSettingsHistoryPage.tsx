import { useParams } from 'react-router-dom'
import { StateBlock } from '../components/StateBlock'
import { useAsync } from '../hooks/useAsync'
import { fetchNamespaceSettingsHistory } from '../lib/authzApi'

/** Settings history under `/n/:namespace/settings/history` (nested in NamespaceLayout). */
export function NamespaceSettingsHistoryPage() {
  const { namespace = '' } = useParams()
  const state = useAsync(
    (signal) => fetchNamespaceSettingsHistory(namespace, signal),
    [namespace],
  )

  return (
    <section className="settings-section" aria-labelledby="ns-settings-history-heading">
      <div className="ns-settings-section-head">
        <div>
          <h2 id="ns-settings-history-heading">Settings history</h2>
          <p className="muted small">
            Successive states of namespace settings. Distinct from the Audit trail (who / why).
          </p>
        </div>
      </div>

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
                    <p className="muted small">
                      {new Date(v.validFrom).toLocaleString()}
                      {v.validTo ? ` → ${new Date(v.validTo).toLocaleString()}` : ' → present'}
                    </p>
                    {v.description ? (
                      <p className="muted small">{v.description}</p>
                    ) : (
                      <p className="muted small">No description</p>
                    )}
                    <p className="muted small">
                      base: {v.basePermission}
                      {' · '}
                      members create repos: {v.membersCanCreateRepos ? 'yes' : 'no'}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          ))}
      </StateBlock>
    </section>
  )
}
