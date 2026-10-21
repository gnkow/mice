import { RefreshCw as ActionRefreshCw } from 'lucide-react'
import type { ReactNode } from 'react'

type Props = {
  loading?: boolean
  error?: string | null
  empty?: boolean
  emptyMessage?: string | ReactNode
  onRetry?: () => void
  children: ReactNode
}

export function StateBlock({
  loading,
  error,
  empty,
  emptyMessage = 'Nothing here yet.',
  onRetry,
  children,
}: Props) {
  if (loading) {
    return (
      <div className="skeleton-block" aria-busy="true" aria-label="Loading">
        <div className="skeleton-line w-40" />
        <div className="skeleton-line w-80" />
        <div className="skeleton-line w-60" />
        <div className="skeleton-line w-70" />
      </div>
    )
  }
  if (error) {
    return (
      <div className="flash flash-error">
        <p className="error">{error}</p>
        {onRetry && (
          <button type="button" className="btn ghost" onClick={onRetry}>
            <ActionRefreshCw size={14} aria-hidden="true" className="button-label-icon" />Retry
          </button>
        )}
      </div>
    )
  }
  if (empty) {
    return (
      <div className="empty-state">
        <span className="empty-state-icon" aria-hidden />
        {typeof emptyMessage === 'string' ? (
          <p className="muted">{emptyMessage}</p>
        ) : (
          emptyMessage
        )}
      </div>
    )
  }
  return <>{children}</>
}
