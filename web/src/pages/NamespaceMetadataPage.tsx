import { useParams } from 'react-router-dom'
import { MetaBody } from '../components/MetaPanel'

/** Metadata tab under `/n/:namespace/metadata`. */
export function NamespaceMetadataPage() {
  const { namespace = '' } = useParams()
  return (
    <section className="settings-section" aria-labelledby="ns-meta-tab-heading">
      <div className="ns-settings-section-head">
        <div>
          <h2 id="ns-meta-tab-heading">Metadata</h2>
          <p className="muted small">
            Labels and key–value metadata attached to this namespace. Separate from settings
            history and the audit trail.
          </p>
        </div>
      </div>
      <MetaBody type="namespace" id={namespace} />
    </section>
  )
}
