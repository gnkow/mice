import { Link } from 'react-router-dom'
import type { CoveringSignature } from '../lib/authzApi'
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
  /** Query string to keep on commit links (including leading `?`). */
  linkSearch?: string
  /** Commits whose QC status is failed (GxP #94). */
  qcFailed?: ReadonlySet<string>
  /** Commits that descend from a QC Failed commit. */
  qcDescendants?: ReadonlySet<string>
  /** Approver may revoke validated (signed) commits from the list (#93). */
  canRevoke?: boolean
  /** Covering signature per commit id (only active / non-revoked entries). */
  coveringByCommit?: ReadonlyMap<string, CoveringSignature>
  onRevoked?: () => void
}

export function CommitList({
  namespace,
  repo,
  commits,
  selectedId,
  linkSearch = '',
  qcFailed,
  qcDescendants,
  canRevoke = false,
  coveringByCommit,
  onRevoked,
}: Props) {
  const base = `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}`
  const profiles = usePrincipalProfiles(commits.map((c) => c.author))

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
              const showRevoke =
                canRevoke &&
                covering != null &&
                !covering.revoked &&
                !qcFailed?.has(c.id)
              return (
                <li key={c.id} className="commit-row-wrap">
                  <Link
                    className={
                      selected ? 'commit-row is-selected' : 'commit-row'
                    }
                    to={`${base}/commits/${encodeURIComponent(c.id)}${linkSearch}`}
                    aria-current={selected ? 'true' : undefined}
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
                      {qcFailed?.has(c.id) ? (
                        <span className="ns-tag ns-tag-warn" data-testid="commit-qc-failed">
                          QC Failed
                        </span>
                      ) : qcDescendants?.has(c.id) ? (
                        <span className="ns-tag ns-tag-muted" data-testid="commit-qc-descendant">
                          Descends from QC Failed
                        </span>
                      ) : null}
                      <MetaPills type="commit" id={`${namespace}/${repo}#${c.id}`} />
                    </span>
                    <span className="commit-sha mono">{c.id.slice(0, 7)}</span>
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
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
