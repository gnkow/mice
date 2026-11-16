import { Download as ActionDownload } from 'lucide-react'
import { useId, useState } from 'react'
import { downloadSignedRecordReport } from '../lib/signedRecordReport'

type Props = {
  namespace: string
  repo: string
  className?: string
}

/** Downloads the signed-record PDF for a repository, with inline status and `role="alert"` errors. */
export function SignedRecordReportButton({ namespace, repo, className = 'btn' }: Props) {
  const errorId = useId()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  async function onClick() {
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      setDone(await downloadSignedRecordReport(namespace, repo))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="signed-record-report">
      <button
        type="button"
        className={className}
        disabled={busy}
        aria-describedby={error ? errorId : undefined}
        onClick={() => void onClick()}
      >
        <ActionDownload size={14} aria-hidden="true" className="button-label-icon" />
        {busy ? 'Preparing report…' : 'Download signed-record report (PDF)'}
      </button>
      {error ? (
        <p id={errorId} className="flash flash-error small" role="alert">
          {error}
        </p>
      ) : null}
      {done ? (
        <p className="muted small" role="status">
          Downloaded {done}.
        </p>
      ) : null}
    </div>
  )
}
