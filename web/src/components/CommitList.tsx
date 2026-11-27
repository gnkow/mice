import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { CoveringSignature } from '../lib/authzApi'
import { qcStatusPillLabel, type CommitQcStatus } from '../lib/commitQc'
import type { Commit } from '../lib/oxen/types'
import { dayKey, formatDayHeading, formatRelativeTime } from '../lib/time'
import { MetaPills } from './MetaPills'
import { usePrincipalProfiles } from './CommitEmail'
import { RevokeSignatureButton } from './RevokeSignatureButton'
import { UserRef } from './UserRef'

type Props = {
  namespace: string
  repo: string
  commits: Commit[]
  selectedId?: string
  /** When selected, navigate here to collapse (list URL). */
  listHref?: string
  /** Query string to keep on commit links (including leading `?`). */
  linkSearch?: string
  /** Per-commit QC status (ADR 0009). */
  qcByCommit?: Record<string, CommitQcStatus>
  /** Commits whose QC status is Invalid. */
  qcInvalid?: ReadonlySet<string>
  /** Commits that descend from an Invalid commit. */
  qcDescendants?: ReadonlySet<string>
  /** @deprecated Prefer qcInvalid. */
  qcFailed?: ReadonlySet<string>
  /** Approver may revoke covering signatures from the list (#93). */
  canRevoke?: boolean
  /** Covering signature per commit id (only active / non-revoked entries). */
  coveringByCommit?: ReadonlyMap<string, CoveringSignature>
  onRevoked?: () => void
  /** Inline expand panel under the selected row. */
  renderExpanded?: (commit: Commit) => ReactNode
}

export function CommitList({
  namespace,
  repo,
  commits,
  selectedId,
  listHref,
  linkSearch = '',
  qcByCommit,
  qcInvalid,
  qcDescendants,
  qcFailed,
  canRevoke = false,
  coveringByCommit,
  onRevoked,
  renderExpanded,
}: Props) {
  const base = `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}`
  const profiles = usePrincipalProfiles(commits.map((c) => c.author))
  const invalid = qcInvalid ?? qcFailed

  const groups: { key: string; heading: string; items: Commit[] }[] = []
  for (const c of commits) {
    const key = dayKey(c.timestamp)
    const last = groups[groups.length - 1]
    if (last && last.key === key) {
      last.items.push(c)
    } else {
      groups.push({
        key,
        heading: formatDayHeading(c.timestamp),
        items: [c],
      })
    }
  }

  return (
    <div className="commit-groups">
      {groups.map((g) => (
        <section key={g.key} className="commit-day">
          <h3 className="commit-day-heading">{g.heading}</h3>
          <ul className="commit-list">
            {g.items.map((c) => {
              const selected = selectedId === c.id
              const covering = coveringByCommit?.get(c.id)
              const status = qcByCommit?.[c.id]
              const showRevoke =
                !selected &&
                canRevoke &&
                covering != null &&
                !covering.revoked &&
                !invalid?.has(c.id)
              const rowHref = selected && listHref
                ? listHref
                : `${base}/commits/${encodeURIComponent(c.id)}${linkSearch}`
              return (
                <li
                  key={c.id}
                  className={
                    selected
                      ? 'commit-row-wrap is-expanded'
                      : 'commit-row-wrap'
                  }
                >
                  <Link
                    className={
                      selected ? 'commit-row is-selected' : 'commit-row'
                    }
                    to={rowHref}
                    aria-current={selected ? 'true' : undefined}
                    aria-expanded={renderExpanded ? selected : undefined}
                    aria-controls={
                      selected && renderExpanded
                        ? `commit-detail-${c.id}`
                        : undefined
                    }
                  >
                    <UserRef
                      author={c.author}
                      storedEmail={c.email}
                      profiles={profiles}
                    />
                    <span className="commit-row-body">
                      <span className="commit-msg">{c.message}</span>
                      <span className="commit-meta">
                        <time
                          dateTime={c.timestamp}
                          title={new Date(c.timestamp).toLocaleString()}
                        >
                          {formatRelativeTime(c.timestamp)}
                        </time>
                      </span>
                      <MetaPills type="commit" id={`${namespace}/${repo}#${c.id}`} />
                    </span>
                    <span className="commit-row-end">
                      {invalid?.has(c.id) ? (
                        <span className="ns-tag ns-tag-warn" data-testid="commit-qc-invalid">
                          QC Invalid
                        </span>
                      ) : qcDescendants?.has(c.id) ? (
                        <span className="ns-tag ns-tag-muted" data-testid="commit-qc-descendant">
                          Descends from Invalid
                        </span>
                      ) : status ? (
                        <span
                          className={
                            status === 'valid'
                              ? 'ns-tag ns-tag-accent'
                              : status === 'invalid'
                                ? 'ns-tag ns-tag-warn'
                                : 'ns-tag ns-tag-muted'
                          }
                          data-testid={`commit-qc-${status}`}
                        >
                          {qcStatusPillLabel(status)}
                        </span>
                      ) : null}
                      <span className="commit-sha mono">{c.id.slice(0, 7)}</span>
                    </span>
                  </Link>
                  {showRevoke ? (
                    <div
                      className="commit-row-revoke"
                      data-testid="commit-list-revoke"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <RevokeSignatureButton
                        signatureId={covering.signatureId}
                        namespace={namespace}
                        repo={repo}
                        commitIds={[c.id]}
                        onRevoked={onRevoked}
                      />
                    </div>
                  ) : null}
                  {selected && renderExpanded ? renderExpanded(c) : null}
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
