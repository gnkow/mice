import { useParams } from 'react-router-dom'
import { SeatVersionList, VersionHistoryList } from '../components/VersionHistory'
import { useAsync } from '../hooks/useAsync'
import { fetchNamespaceMembershipHistory } from '../lib/authzApi'

/** Membership history under `/n/:namespace/settings/members/history` (nested in NamespaceSettingsLayout). */
export function NamespaceMembershipHistoryPage() {
  const { namespace = '' } = useParams()
  const state = useAsync((signal) => fetchNamespaceMembershipHistory(namespace, signal), [namespace])

  return (
    <section className="settings-section" aria-labelledby="ns-members-history-heading">
      <div className="ns-settings-section-head">
        <div>
          <h2 id="ns-members-history-heading">Membership history</h2>
          <p className="muted small">
            Successive member sets for <code>{namespace}</code>. Distinct from the Audit trail (who / why).
          </p>
        </div>
      </div>
      <VersionHistoryList
        state={state}
        label="Membership versions"
        emptyMessage="No versions recorded."
        renderBody={(v) => <SeatVersionList seats={v.members} emptyLabel="No members" />}
      />
    </section>
  )
}
