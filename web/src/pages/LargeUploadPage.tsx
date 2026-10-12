import { Navigate, useParams, useSearchParams } from 'react-router-dom'
import { lastBranch } from '../lib/lastBranch'

/** Legacy `/upload` route → Data tab with unified Upload modal. */
export function LargeUploadPage() {
  const { namespace = '', repo = '' } = useParams()
  const [params] = useSearchParams()
  const branch =
    params.get('branch') || lastBranch(namespace, repo, 'main')
  const dest = params.get('path') || params.get('dst') || ''
  const qs = new URLSearchParams({ manage: 'upload' })
  if (dest) qs.set('path', dest)

  return (
    <Navigate
      to={`/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}/tree/${encodeURIComponent(branch)}?${qs.toString()}`}
      replace
    />
  )
}
