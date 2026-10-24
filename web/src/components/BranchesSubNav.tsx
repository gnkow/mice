import { NavLink, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeftRight, GitBranch, GitMerge, Layers } from 'lucide-react'

/** Switches between the Branches, Compare (diff) and Merge views, keeping base/head. */
export function BranchesSubNav() {
  const { namespace = '', repo = '' } = useParams()
  const { pathname } = useLocation()
  const [params] = useSearchParams()
  const base = `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}`

  const from = params.get('base')
  const to = params.get('head')
  const range =
    from && to
      ? `?base=${encodeURIComponent(from)}&head=${encodeURIComponent(to)}`
      : ''

  const onCompare =
    pathname === `${base}/compare` || pathname === `${base}/df-compare`
  const onMerge = pathname === `${base}/merge`
  const onStages =
    pathname === `${base}/stages` ||
    pathname.startsWith(`${base}/stages/`)
  const onBranches = !onCompare && !onMerge && !onStages

  return (
    <nav className="branches-subnav" aria-label="Branch views">
      <NavLink
        to={`${base}/branches`}
        className={() => (onBranches ? 'active' : undefined)}
        end
      >
        <GitBranch size={14} aria-hidden="true" className="button-label-icon" />
        Branches
      </NavLink>
      <NavLink
        to={`${base}/compare${range}`}
        className={() => (onCompare ? 'active' : undefined)}
      >
        <ArrowLeftRight size={14} aria-hidden="true" className="button-label-icon" />
        Compare
      </NavLink>
      <NavLink
        to={`${base}/merge${range}`}
        className={() => (onMerge ? 'active' : undefined)}
      >
        <GitMerge size={14} aria-hidden="true" className="button-label-icon" />
        Merge
      </NavLink>
      <NavLink
        to={`${base}/stages`}
        className={() => (onStages ? 'active' : undefined)}
      >
        <Layers size={14} aria-hidden="true" className="button-label-icon" />
        Stages
      </NavLink>
    </nav>
  )
}
