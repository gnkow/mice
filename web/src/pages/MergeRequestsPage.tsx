import { GitPullRequest } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { BranchesSubNav } from '../components/BranchesSubNav'
import { MergeRequestSignPanel } from '../components/MergeRequestSignPanel'
import { StateBlock } from '../components/StateBlock'
import { useAsync } from '../hooks/useAsync'
import { listMergeRequests } from '../lib/mergeRequests'

/** Lists BFF merge requests; Sign opens the shared reason/signature ceremony modal. */
export function MergeRequestsPage() {
  const { namespace = '', repo = '' } = useParams()
  const base = `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}`
  const state = useAsync(
    (signal) => listMergeRequests(namespace, repo, signal),
    [namespace, repo],
  )
  const [signId, setSignId] = useState<string | null>(null)

  return (
    <main className="page">
      <BranchesSubNav />
      <div className="page-head">
        <div>
          <h1>
            <GitPullRequest
              size={20}
              aria-hidden="true"
              className="button-label-icon"
            />
            Merge requests
          </h1>
          <p className="lede">
            Open requests into validated branches are signed in the browser. The CLI
            prints a link here after opening a request.
          </p>
        </div>
        <Link className="btn ghost" to={`${base}/merge`}>
          Branch merge
        </Link>
      </div>

      <StateBlock
        loading={state.kind === 'loading'}
        error={state.kind === 'error' ? state.message : null}
        onRetry={() => state.reload()}
      >
        {state.kind === 'ok' &&
          (state.data.length === 0 ? (
            <p className="muted">No merge requests yet.</p>
          ) : (
            <ul className="ns-member-list" style={{ listStyle: 'none', padding: 0 }}>
              {state.data.map((mr) => (
                <li key={mr.id} className="ns-member-row">
                  <div className="ns-member-main">
                    <p>
                      <strong>
                        {mr.sourceBranch} → {mr.targetBranch}
                      </strong>
                      <span className="ns-tag"> {mr.status}</span>
                    </p>
                    <p className="muted small mono">{mr.id}</p>
                    <p className="muted small">
                      {new Date(mr.createdAt).toLocaleString()}
                      {' · '}
                      heads {mr.expectedSourceHead.slice(0, 8)} /{' '}
                      {mr.expectedTargetHead.slice(0, 8)}
                    </p>
                  </div>
                  {mr.status === 'open' || mr.status === 'stale' ? (
                    <button
                      type="button"
                      className="btn primary"
                      onClick={() => setSignId(mr.id)}
                    >
                      Sign
                    </button>
                  ) : (
                    <Link
                      className="btn ghost"
                      to={`${base}/merge-requests/${encodeURIComponent(mr.id)}`}
                    >
                      View
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          ))}
      </StateBlock>

      {signId ? (
        <MergeRequestSignPanel
          mergeRequestId={signId}
          namespace={namespace}
          repo={repo}
          embedded
          onDismiss={() => setSignId(null)}
          onComplete={() => state.reload()}
        />
      ) : null}
    </main>
  )
}
