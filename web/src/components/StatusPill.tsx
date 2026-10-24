type Tone = 'ok' | 'active' | 'warn' | 'bad' | 'neutral'

const TONES: Record<string, Tone> = {
  succeeded: 'ok',
  ready: 'ok',
  connected: 'ok',
  running: 'active',
  provisioning: 'active',
  preparing: 'active',
  stopping: 'active',
  queued: 'active',
  pending: 'active',
  cancelled: 'warn',
  failed: 'bad',
  error: 'bad',
  stopped: 'neutral',
  destroyed: 'neutral',
}

export function statusTone(status: string): Tone {
  return TONES[status.toLowerCase()] ?? 'neutral'
}

/** Single status indicator shared by jobs, sessions and workspaces. */
export function StatusPill({
  status,
  label,
  title,
}: {
  status: string
  label?: string
  title?: string
}) {
  const text = label ?? status.charAt(0).toUpperCase() + status.slice(1)
  return (
    <span className={`pill status-pill ${statusTone(status)}`} title={title} data-status={status}>
      {text}
    </span>
  )
}
