import { Link, useParams } from 'react-router-dom'
import { Breadcrumbs, repoCrumbs } from '../components/Breadcrumbs'
import { CommitList } from '../components/CommitList'
import { StateBlock } from '../components/StateBlock'
import { useAsync } from '../hooks/useAsync'
import { getCommit, getCommitParents } from '../lib/oxen/api'
import { formatRelativeTime } from '../lib/time'

export function CommitPage() {
  const { namespace = '', repo = '', commitId = '' } = useParams()

  const detail = useAsync(
    (signal) => getCommit(namespace, repo, commitId, signal),
    [namespace, repo, commitId],
  )
  const parents = useAsync(
    (signal) => getCommitParents(namespace, repo, commitId, signal),
    [namespace, repo, commitId],
  )

  const commit = detail.kind === 'ok' ? detail.data.commit : null
  const base = `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}`

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <Breadcrumbs
            items={repoCrumbs(
              namespace,
              repo,
              { label: 'Commits', to: `${base}/commits` },
              { label: commitId },
            )}
          />
          <h1>{commit?.message ?? 'Commit'}</h1>
          <p className="lede mono">{commitId}</p>
        </div>
        {commit && (
          <Link className="btn ghost" to={`${base}/tree/${commit.id}`}>
            Browse tree
          </Link>
        )}
      </div>

      <StateBlock
        loading={detail.kind === 'loading'}
        error={detail.kind === 'error' ? detail.message : null}
      >
        {commit && (
          <dl className="kv panel">
            <div>
              <dt>Author</dt>
              <dd>
                {commit.author} &lt;{commit.email}&gt;
              </dd>
            </div>
            <div>
              <dt>When</dt>
              <dd>
                <time
                  dateTime={commit.timestamp}
                  title={new Date(commit.timestamp).toLocaleString()}
                >
                  {formatRelativeTime(commit.timestamp)}
                </time>
              </dd>
            </div>
            <div>
              <dt>Parents</dt>
              <dd>
                {commit.parent_ids.length === 0
                  ? '—'
                  : commit.parent_ids.map((id, i) => (
                      <span key={id}>
                        {i > 0 && ', '}
                        <Link
                          className="mono"
                          to={`${base}/commits/${encodeURIComponent(id)}`}
                        >
                          {id.slice(0, 8)}
                        </Link>
                      </span>
                    ))}
              </dd>
            </div>
          </dl>
        )}
      </StateBlock>

      <section className="panel">
        <h2 className="section-label">Ancestry</h2>
        <StateBlock
          loading={parents.kind === 'loading'}
          error={parents.kind === 'error' ? parents.message : null}
          empty={
            parents.kind === 'ok' && parents.data.commits.length === 0
          }
          emptyMessage="No parent history."
        >
          {parents.kind === 'ok' && (
            <CommitList
              namespace={namespace}
              repo={repo}
              commits={parents.data.commits}
            />
          )}
        </StateBlock>
      </section>
    </main>
  )
}
