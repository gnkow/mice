import { useParams } from 'react-router-dom'
import { ApproverVersionSeats, VersionHistoryList } from '../components/VersionHistory'
import { useAsync } from '../hooks/useAsync'
import { fetchApproverHistory } from '../lib/authzApi'

/** Approver-set history under `/n/:namespace/settings/approvers/history`. */
export function NamespaceApproverHistoryPage() {
  const { namespace = '' } = useParams()
  const state = useAsync(
    (signal) => fetchApproverHistory({ ns: namespace }, signal),
    [namespace],
  )

  return (
    <section
      className="settings-section"
      aria-labelledby="ns-approver-history-heading"
      data-testid="approver-history"
    >
      <div className="ns-settings-section-head">
        <div>
          <h2 id="ns-approver-history-heading">Approver history</h2>
          <p className="muted small">
            Successive approver sets for <code>{namespace}</code>. Distinct from
            the Audit trail (who / why).
          </p>
        </div>
      </div>
      <VersionHistoryList
        state={state}
        label="Approver versions"
        emptyMessage="No versions recorded."
        renderBody={(v) => <ApproverVersionSeats approvers={v.approvers} />}
      />
    </section>
  )
}
