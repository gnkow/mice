import { RefreshCw, Search, UsersRound } from 'lucide-react'
import { useEffect, useId, useMemo, useState } from 'react'
import type { AuthUserGroup } from '../lib/auth'
import { refreshAuthMeGroups } from '../lib/auth'
import { groupMatchesSearch } from '../lib/groupRef'
import { GroupRef } from './GroupRef'
import { Pagination, paginate } from './Pagination'

/** Profile shows 5 groups per page. */
export const PROFILE_GROUP_PAGE_SIZE = 5

/**
 * Profile → Account → Identity → Group membership.
 * Lists session IdP groups with search, pagination, and directory refresh.
 */
export function ProfileGroupMembership({
  groups,
  onGroupsChange,
}: {
  groups: AuthUserGroup[]
  /** Called after a successful directory refresh so the parent can keep `/auth/me` in sync. */
  onGroupsChange?: (groups: AuthUserGroup[]) => void
}) {
  const searchId = useId()
  const listId = useId()
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filtered = useMemo(
    () => groups.filter((g) => groupMatchesSearch(g, query)),
    [groups, query],
  )
  const slice = paginate(filtered, page, PROFILE_GROUP_PAGE_SIZE)

  useEffect(() => {
    setPage(1)
  }, [query])

  async function onRefresh() {
    setBusy(true)
    setError(null)
    try {
      const next = await refreshAuthMeGroups()
      onGroupsChange?.(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not refresh groups')
    } finally {
      setBusy(false)
    }
  }

  const countLabel = query.trim()
    ? `${filtered.length} of ${groups.length} group${groups.length === 1 ? '' : 's'}`
    : `${groups.length} group${groups.length === 1 ? '' : 's'}`

  const refreshButton = (
    <button
      type="button"
      className="btn ghost"
      data-testid="profile-groups-refresh"
      onClick={() => void onRefresh()}
      disabled={busy}
      aria-busy={busy || undefined}
      aria-controls={listId}
      aria-label={busy ? 'Refreshing groups' : 'Refresh groups'}
    >
      <RefreshCw
        size={14}
        className={`button-label-icon${busy ? ' is-spinning' : ''}`}
        aria-hidden="true"
      />
      Refresh
    </button>
  )

  return (
    <div className="profile-group-membership" data-testid="profile-group-membership">
      <div className="ns-settings-section-head profile-group-membership-head">
        <div>
          <h4 id="profile-group-membership-heading">
            <UsersRound size={16} className="button-label-icon" aria-hidden="true" />
            Group membership
          </h4>
          <p className="muted small">
            IdP groups on this sign-in. Refresh loads the live directory list
            (including after overage or membership changes).
          </p>
        </div>
      </div>

      {error && (
        <p className="flash flash-error" role="alert">
          {error}
        </p>
      )}

      {groups.length === 0 ? (
        <div className="profile-group-toolbar">
          <p className="muted small" role="status" id={listId}>
            No IdP groups on this session.
          </p>
          {refreshButton}
        </div>
      ) : (
        <>
          <div className="profile-group-toolbar">
            <label className="profile-group-search" htmlFor={searchId}>
              <Search size={14} aria-hidden="true" />
              <span className="visually-hidden">Search groups</span>
              <input
                id={searchId}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search groups…"
                data-testid="profile-groups-search"
                autoComplete="off"
              />
            </label>
            <div className="profile-group-count-row">
              <p className="muted small" role="status">
                {countLabel}
              </p>
              {refreshButton}
            </div>
          </div>

          {filtered.length === 0 ? (
            <p className="muted small" role="status" id={listId}>
              No groups match “{query.trim()}”.
            </p>
          ) : (
            <>
              <ul
                className="profile-group-list"
                id={listId}
                aria-labelledby="profile-group-membership-heading"
              >
                {slice.items.map((group) => (
                  <li key={group.bindingKey} className="profile-group-row">
                    <GroupRef
                      bindingKey={group.bindingKey}
                      displayName={group.displayName}
                    />
                  </li>
                ))}
              </ul>
              {slice.pageCount > 1 ? (
                <Pagination
                  page={slice.page}
                  pageCount={slice.pageCount}
                  total={slice.total}
                  onPageChange={setPage}
                  label="Group membership pagination"
                />
              ) : null}
            </>
          )}
        </>
      )}
    </div>
  )
}
