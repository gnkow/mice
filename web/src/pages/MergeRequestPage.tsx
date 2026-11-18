import { GitMerge as ActionGitMerge } from 'lucide-react'
import { useId } from 'react'
import { Link, useParams } from 'react-router-dom'
import { BranchesSubNav } from '../components/BranchesSubNav'
import { MergeRequestSignPanel } from '../components/MergeRequestSignPanel'

/**
 * GxP #92 — merge-request signing ceremony page (also available as a modal from the list).
 */
export function MergeRequestPage() {
  const { namespace = '', repo = '', mergeRequestId = '' } = useParams()
  const base = `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}`
  const titleId = useId()

  return (
    <main className="page">
      <BranchesSubNav />
      <div className="page-head">
        <div>
          <h1 id={titleId}>
            <ActionGitMerge
              size={20}
              aria-hidden="true"
              className="button-label-icon"
            />
            Sign merge request
          </h1>
          <p className="lede">
            Review the merge content hash, confirm meaning <strong>Approved</strong>,
            then complete step-up MFA. The CLI can open a merge request and print this
            page link; signing happens only in the browser.
          </p>
        </div>
        <Link className="btn ghost" to={`${base}/merge-requests`}>
          All merge requests
        </Link>
      </div>

      <MergeRequestSignPanel
        mergeRequestId={mergeRequestId}
        namespace={namespace}
        repo={repo}
      />
    </main>
  )
}
