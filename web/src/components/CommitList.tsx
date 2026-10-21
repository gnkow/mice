import { Link } from 'react-router-dom'
import type { Commit } from '../lib/oxen/types'
import { MetaPills } from './MetaPills'
import { AuthorAvatar } from './AuthorAvatar'
import { dayKey, formatDayHeading, formatRelativeTime } from '../lib/time'

type Props = {
  namespace: string
  repo: string
  commits: Commit[]
  selectedId?: string
  /** Query string to keep on commit links (including leading `?`). */
  linkSearch?: string
}

export function CommitList({
  namespace,
  repo,
  commits,
  selectedId,
  linkSearch = '',
}: Props) {
  const base = `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}`

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
              return (
                <li key={c.id}>
                  <Link
                    className={
                      selected ? 'commit-row is-selected' : 'commit-row'
                    }
                    to={`${base}/commits/${encodeURIComponent(c.id)}${linkSearch}`}
                    aria-current={selected ? 'true' : undefined}
                  >
                    <AuthorAvatar name={c.author} />
                    <span className="commit-row-body">
                      <span className="commit-msg">{c.message}</span>
                      <span className="commit-meta">
                        {c.author}
                        {' · '}
                        <time
                          dateTime={c.timestamp}
                          title={new Date(c.timestamp).toLocaleString()}
                        >
                          {formatRelativeTime(c.timestamp)}
                        </time>
                      </span>
                      <MetaPills type="commit" id={`${namespace}/${repo}#${c.id}`} />
                    </span>
                    <span className="commit-sha mono">{c.id.slice(0, 7)}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
