import { Star } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { FavoriteStar } from './FavoriteStar'
import {
  FAVORITE_TYPES,
  favoriteHref,
  favoriteLabel,
  useFavorites,
  type FavoriteType,
} from '../lib/favorites'
import { formatRelativeTime } from '../lib/time'

const TAB_LABEL: Record<FavoriteType, string> = {
  namespace: 'Namespaces',
  repo: 'Repositories',
  branch: 'Branches',
  stage: 'Stages',
  job: 'Jobs',
  session: 'Sessions',
}

export function ProfileFavoritesSection() {
  const { items, ready } = useFavorites()
  const [params, setParams] = useSearchParams()
  const counts = Object.fromEntries(FAVORITE_TYPES.map((t) => [t, items.filter((f) => f.type === t).length])) as Record<FavoriteType, number>
  const requested = params.get('type') as FavoriteType | null
  const active: FavoriteType =
    requested && (FAVORITE_TYPES as readonly string[]).includes(requested)
      ? requested
      : FAVORITE_TYPES.find((t) => counts[t] > 0) ?? FAVORITE_TYPES[0]
  const rows = items.filter((f) => f.type === active)

  function select(type: FavoriteType) {
    const next = new URLSearchParams(params)
    next.set('tab', 'favorites')
    next.set('type', type)
    setParams(next, { replace: true })
  }

  return (
    <section className="settings-section" id="favorites" aria-labelledby="profile-favorites-heading">
      <h2 id="profile-favorites-heading"><Star size={18} className="button-label-icon" aria-hidden="true" />Favorites</h2>
      <p className="muted small">Your personal favorites. They are listed first in their lists.</p>
      <div role="tablist" aria-label="Favorite types" className="favorites-tabs btn-row">
        {FAVORITE_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`fav-tab-${t}`}
            aria-selected={t === active}
            aria-controls="fav-panel"
            className={`btn ${t === active ? 'primary' : 'ghost'} ${counts[t] ? '' : 'muted'}`}
            onClick={() => select(t)}
          >
            {TAB_LABEL[t]} <span className="pill" aria-label={`${counts[t]} favorites`}>{counts[t]}</span>
          </button>
        ))}
      </div>
      <div role="tabpanel" id="fav-panel" aria-labelledby={`fav-tab-${active}`}>
        {!ready && <p role="status">Loading favorites...</p>}
        {ready && rows.length === 0 && (
          <p className="muted">No favorite {TAB_LABEL[active].toLowerCase()} yet. Use the star icon on a {active} to add one.</p>
        )}
        {ready && rows.length > 0 && (
          <ul className="card-list">
            {rows.map((f) => {
              const href = favoriteHref(f)
              const label = favoriteLabel(f)
              return (
                <li key={`${f.type}:${f.id}`} className="favorites-row">
                  {href ? <Link to={href}>{label}</Link> : <span>{label}</span>}
                  {f.namespace && f.repo && f.type !== 'repo' && <span className="muted small mono"> {f.namespace}/{f.repo}</span>}
                  <span className="muted small"> · added {formatRelativeTime(f.at)}</span>
                  <FavoriteStar type={f.type} id={f.id} label={label} />
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
