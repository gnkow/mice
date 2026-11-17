import { useMemo, type ReactNode } from 'react'
import type { AsyncState } from '../hooks/useAsync'
import type { ApproverPrincipal, SeatVersionEntry } from '../lib/authzApi'
import { usePrincipalProfiles } from './CommitEmail'
import { GroupPrincipalLabel } from './GroupPrincipalLabel'
import { StateBlock } from './StateBlock'
import { UserRef } from './UserRef'

type Interval = { validFrom: string; validTo: string | null }

type Props<T extends Interval> = {
  state: AsyncState<{ versions: T[] }> & { reload: () => void }
  emptyMessage: string
  /** Body shown under each version's date range. */
  renderBody: (version: T) => ReactNode
  /** Accessible name for the list (e.g. "Membership versions"). */
  label: string
}

/** `Version n · current` rows with their validity interval; shared by every entity-history view. */
export function VersionHistoryList<T extends Interval>({
  state,
  emptyMessage,
  renderBody,
  label,
}: Props<T>) {
  if (state.kind === 'error') {
    return (
      <div className="flash flash-error" role="alert">
        <p>{state.message}</p>
        <button type="button" className="btn ghost" onClick={() => state.reload()}>
          Retry
        </button>
      </div>
    )
  }
  return (
    <StateBlock loading={state.kind === 'loading'} onRetry={() => state.reload()}>
      {state.kind === 'ok' &&
        (state.data.versions.length === 0 ? (
          <p className="muted">{emptyMessage}</p>
        ) : (
          <ol
            className="ns-member-list"
            style={{ listStyle: 'none', padding: 0 }}
            aria-label={label}
          >
            {state.data.versions.map((v, i) => (
              <li key={`${v.validFrom}-${i}`} className="ns-member-row" data-testid="history-version">
                <div className="ns-member-main">
                  <p>
                    <strong>Version {i + 1}</strong>
                    {v.validTo === null ? <span className="ns-tag"> current</span> : null}
                  </p>
                  <p className="muted small">
                    {new Date(v.validFrom).toLocaleString()}
                    {v.validTo ? ` → ${new Date(v.validTo).toLocaleString()}` : ' → present'}
                  </p>
                  {renderBody(v)}
                </div>
              </li>
            ))}
          </ol>
        ))}
    </StateBlock>
  )
}

/** Approver principals for one history version — always UserRef (never raw iss|sub). */
export function ApproverVersionSeats({
  approvers,
  emptyLabel = 'No approvers',
}: {
  approvers: ApproverPrincipal[]
  emptyLabel?: string
}) {
  const authors = useMemo(
    () => approvers.map((a) => `${a.iss}|${a.sub}`),
    [approvers],
  )
  const profiles = usePrincipalProfiles(authors)
  if (approvers.length === 0) return <p className="muted small">{emptyLabel}</p>
  return (
    <ul className="muted small" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {approvers.map((a) => {
        const key = `${a.iss}|${a.sub}`
        return (
          <li key={key}>
            <UserRef author={key} profiles={profiles} />
          </li>
        )
      })}
    </ul>
  )
}

/** Seats (user or group + role) captured in a membership or collaborator version. */
export function SeatVersionList({ seats, emptyLabel }: { seats: SeatVersionEntry[]; emptyLabel: string }) {
  const authors = useMemo(
    () => seats.filter((s) => s.kind === 'user').map((s) => s.key),
    [seats],
  )
  const profiles = usePrincipalProfiles(authors)
  if (seats.length === 0) return <p className="muted small">{emptyLabel}</p>
  return (
    <ul className="muted small" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {seats.map((s) => (
        <li key={`${s.kind}:${s.key}`}>
          {s.kind === 'group' ? (
            <GroupPrincipalLabel group={s.key} inline />
          ) : (
            <UserRef author={s.key} profiles={profiles} />
          )}{' '}
          <span className="ns-tag">{s.role}</span>
        </li>
      ))}
    </ul>
  )
}
