import { Link } from 'react-router-dom'
import {
  formatSessionMount,
  sessionImageLabel,
  sessionMounts,
  sessionStatusClass,
  sessionTitle,
  shortenSessionId,
  statusLabel,
  type DesktopSession,
} from '../lib/sessions'
import { formatRelativeTime } from '../lib/time'

type Props = {
  session: DesktopSession
}

/** Shared session row for the global Sessions list (Jobs-card layout). */
export function SessionSummaryCard({ session }: Props) {
  const href = `/sessions/${encodeURIComponent(session.id)}`
  const title = sessionTitle(session)
  const image = sessionImageLabel(session)
  const mounts = sessionMounts(session)
  const workspaceMounts = mounts.filter((m) => m.workspace_id)
  const metaParts = [
    image,
    session.guest_user ? `user ${session.guest_user}` : '',
    session.provisioner,
  ].filter(Boolean)

  return (
    <Link className="repo-summary-card jobs-list-card" to={href}>
      <span className="jobs-card-body">
        <span className="jobs-card-top">
          <span className="jobs-card-heading">
            <span className="jobs-card-name" title={title}>
              {title}
            </span>
            <span className="jobs-card-id mono muted" title={session.id}>
              {shortenSessionId(session.id, 10)}
            </span>
          </span>
          <span className="jobs-card-tags">
            {workspaceMounts.length > 0 ? (
              <span className="pill" title={workspaceMounts.map(formatSessionMount).join(', ')}>
                {workspaceMounts.length === 1 ? 'workspace' : `${workspaceMounts.length} workspaces`}
              </span>
            ) : null}
            <span className={sessionStatusClass(session.status)}>
              {statusLabel(session.status)}
            </span>
          </span>
        </span>

        {metaParts.length > 0 ? (
          <span
            className="jobs-card-meta mono muted"
            title={metaParts.join(' · ')}
          >
            {metaParts.join(' · ')}
          </span>
        ) : null}

        <span className="jobs-card-refs">
          <span className="jobs-ref">
            <span className="jobs-ref-label">Workspaces</span>
            {workspaceMounts.length === 0 ? (
              <span className="muted">None</span>
            ) : workspaceMounts.length === 1 ? (
              <span className="mono" title={formatSessionMount(workspaceMounts[0]!)}>
                {formatSessionMount(workspaceMounts[0]!)}
                {' '}({workspaceMounts[0]!.mount_mode})
              </span>
            ) : (
              <span className="mono" title={workspaceMounts.map(formatSessionMount).join('\n')}>
                {workspaceMounts.length} workspaces
              </span>
            )}
          </span>
        </span>

        <span className="jobs-card-footer muted">
          <span title={session.created_at}>
            {formatRelativeTime(session.created_at)}
          </span>
          {session.recording ? <span>recording</span> : null}
          {session.error ? (
            <span className="jobs-card-exit" title={session.error}>
              error
            </span>
          ) : null}
        </span>
      </span>
    </Link>
  )
}
