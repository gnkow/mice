import { useParams } from 'react-router-dom'
import { VersionHistoryList } from '../components/VersionHistory'
import { useAsync } from '../hooks/useAsync'
import { fetchCustomRoleHistory } from '../lib/authzApi'

/** Custom-role definition history under `/n/:namespace/settings/custom-roles/history`. */
export function NamespaceCustomRolesHistoryPage() {
  const { namespace = '' } = useParams()
  const state = useAsync((signal) => fetchCustomRoleHistory(namespace, signal), [namespace])

  return (
    <section className="settings-section" aria-labelledby="ns-roles-history-heading">
      <div className="ns-settings-section-head">
        <div>
          <h2 id="ns-roles-history-heading">Custom roles history</h2>
          <p className="muted small">
            Successive definitions of each custom role in <code>{namespace}</code>. Distinct from the Audit trail
            (who / why).
          </p>
        </div>
      </div>
      <VersionHistoryList
        state={state}
        label="Custom role versions"
        emptyMessage="No versions recorded."
        renderBody={(v) => (
          <>
            <p>
              <strong>{v.definition.name ?? v.roleId}</strong>{' '}
              <span className="ns-tag">{v.kind === 'namespace' ? 'namespace role' : 'repository role'}</span>
            </p>
            {v.definition.description ? (
              <p className="muted small">{v.definition.description}</p>
            ) : null}
            <p className="muted small">
              {v.kind === 'repo' && v.definition.base ? `base: ${v.definition.base} · ` : null}
              {v.kind === 'namespace' && v.definition.baseRepositoryRole
                ? `base repository role: ${v.definition.baseRepositoryRole} · `
                : null}
              permissions: {(v.definition.permissions ?? []).join(', ') || 'none'}
            </p>
          </>
        )}
      />
    </section>
  )
}
