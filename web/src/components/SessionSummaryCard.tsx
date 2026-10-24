import { Link } from 'react-router-dom'
import {
  formatSessionMount,
  sessionImageLabel,
  sessionMounts,
  sessionTitle,
  shortenSessionId,
  type DesktopSession,
} from '../lib/sessions'
import { StatusPill } from './StatusPill'
import { MetaPills } from './MetaPills'
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
            <StatusPill status={session.status} />
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
            <span className="jobs-ref-label">Mounts</span>
            {mounts.length === 0 ? (
              <span className="muted">None</span>
            ) : mounts.length === 1 ? (
              <span className="mono" title={formatSessionMount(mounts[0]!)}>
                {formatSessionMount(mounts[0]!)}
                {' '}({mounts[0]!.mount_mode})
              </span>
            ) : (
              <span className="mono" title={mounts.map(formatSessionMount).join('\n')}>
                {mounts.length} workspaces
              </span>
            )}
          </span>
        </span>

        <MetaPills type="session" id={session.id} />

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
