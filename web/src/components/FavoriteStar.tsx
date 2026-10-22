import { useState } from 'react'
import { setFavorite, useFavorites, type FavoriteType } from '../lib/favorites'
import { StarIcon } from './icons'

type Props = { type: FavoriteType; id: string; label?: string; className?: string }

export function FavoriteStar({ type, id, label, className = '' }: Props) {
  const { has, ready } = useFavorites()
  const [error, setError] = useState(false)
  const on = has(type, id)
  const name = label ?? id
  const title = error ? 'Could not update favorite' : on ? 'Remove from favorites' : 'Add to favorites'
  return (
    <button
      type="button"
      className={`icon-round favorite-star ${on ? 'is-on' : ''} ${className}`}
      aria-pressed={on}
      aria-label={`${on ? 'Remove' : 'Add'} ${name} ${on ? 'from' : 'to'} favorites`}
      title={title}
      disabled={!ready}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setError(false)
        setFavorite(type, id, !on).catch(() => setError(true))
      }}
    >
      <StarIcon filled={on} size={14} />
    </button>
  )
}
