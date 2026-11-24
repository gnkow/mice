import { Download as ActionDownload, FileJson as ActionJson } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import {
  downloadSignedRecordReport,
  type SignedRecordReportFormat,
} from '../lib/signedRecordReport'

type Props = {
  namespace: string
  repo: string
  className?: string
  /** Compact History toolbar: PDF only (JSON remains on Settings). */
  compact?: boolean
}

/** Downloads the signed-record report, with inline status and `role="alert"` errors. */
export function SignedRecordReportButton({
  namespace,
  repo,
  className = 'btn',
  compact = false,
}: Props) {
  const errorId = useId()
  const errorTitleId = useId()
  const errorRef = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState<SignedRecordReportFormat | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  async function onDownload(format: SignedRecordReportFormat) {
    setBusy(format)
    setError(null)
    setDone(null)
    try {
      setDone(await downloadSignedRecordReport(namespace, repo, format))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed')
      window.setTimeout(() => errorRef.current?.focus(), 0)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="signed-record-report" data-testid="signed-record-report">
      <div className="btn-row" role="group" aria-label="Signed-record report downloads">
        <button
          type="button"
          className={className}
          disabled={busy !== null}
          aria-describedby={error ? errorId : undefined}
          onClick={() => void onDownload('pdf')}
        >
          <ActionDownload size={14} aria-hidden="true" className="button-label-icon" />
          {busy === 'pdf'
            ? 'Preparing report…'
            : compact
              ? 'Download PDF'
              : 'Download signed-record report (PDF)'}
        </button>
        {!compact ? (
          <button
            type="button"
            className="btn ghost"
            disabled={busy !== null}
            aria-describedby={error ? errorId : undefined}
            onClick={() => void onDownload('json')}
          >
            <ActionJson size={14} aria-hidden="true" className="button-label-icon" />
            {busy === 'json' ? 'Preparing JSON…' : 'Download JSON'}
          </button>
        ) : null}
      </div>
      {error ? (
        <div
          ref={errorRef}
          id={errorId}
          className="flash flash-error small"
          role="alert"
          tabIndex={-1}
          aria-labelledby={errorTitleId}
        >
          <h3 id={errorTitleId} className="reason-prompt-heading">
            There is a problem
          </h3>
          <p>{error}</p>
        </div>
      ) : null}
      {done ? (
        <p className="muted small" role="status" aria-live="polite">
          Downloaded {done}.
        </p>
      ) : null}
    </div>
  )
}
