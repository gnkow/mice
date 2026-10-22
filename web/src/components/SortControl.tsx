import { useCallback, useState } from 'react'

/** Comparators shared by the list pages. */
const text = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? '').localeCompare(b ?? '', undefined, { numeric: true, sensitivity: 'base' })
export const cmp = {
  text,
  /** Newest first; missing dates last. */
  dateDesc: (a: string | null | undefined, b: string | null | undefined) =>
    (b ? Date.parse(b) || 0 : -Infinity) - (a ? Date.parse(a) || 0 : -Infinity) || 0,
  dateAsc: (a: string | null | undefined, b: string | null | undefined) =>
    (a ? Date.parse(a) || Infinity : Infinity) - (b ? Date.parse(b) || Infinity : Infinity) || 0,
}

export type SortKey = 'favorites' | 'newest' | 'oldest' | 'name' | 'name-desc'

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'favorites', label: 'Favorites' },
  { key: 'newest', label: 'Newest' },
  { key: 'oldest', label: 'Oldest' },
  { key: 'name', label: 'Name (A–Z)' },
  { key: 'name-desc', label: 'Name (Z–A)' },
]

/** How a list exposes the fields every list can be sorted by. */
export type SortFields<T> = {
  name: (item: T) => string | null | undefined
  /** Creation time (or the closest the data offers); items without one sort last. */
  created: (item: T) => string | null | undefined
}

/** Per-list sort choice (persisted). Every list offers the same options. */
export function useListSort<T>(list: string, fields: SortFields<T>) {
  const storageKey = `mice.sort.${list}`
  const [key, setKeyState] = useState<SortKey>(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      if (SORT_OPTIONS.some((o) => o.key === saved)) return saved as SortKey
    } catch { /* ignore */ }
    return 'favorites'
  })
  const setKey = (next: SortKey) => {
    try { localStorage.setItem(storageKey, next) } catch { /* ignore */ }
    setKeyState(next)
  }
  const apply = useCallback(
    (items: T[], isFavorite: (item: T) => boolean) => {
      const byName = (a: T, b: T) => cmp.text(fields.name(a), fields.name(b))
      const compare: (a: T, b: T) => number =
        key === 'favorites' ? (a, b) => Number(isFavorite(b)) - Number(isFavorite(a)) || byName(a, b)
        : key === 'newest' ? (a, b) => cmp.dateDesc(fields.created(a), fields.created(b)) || byName(a, b)
        : key === 'oldest' ? (a, b) => cmp.dateAsc(fields.created(a), fields.created(b)) || byName(a, b)
        : key === 'name' ? byName
        : (a, b) => -byName(a, b)
      return [...items].sort(compare)
    },
    [key, fields],
  )
  return { sortKey: key, setKey, apply }
}

type Sort = ReturnType<typeof useListSort<never>>

/** Sort-by field, laid out like the search field so it lives in the list toolbar. */
export function SortControl({ sort, id }: { sort: Pick<Sort, 'sortKey' | 'setKey'>; id: string }) {
  return (
    <div className="ns-sort-field">
      <label className="ns-search-label" htmlFor={`${id}-sort`}>Sort by</label>
      <select id={`${id}-sort`} value={sort.sortKey} onChange={(e) => sort.setKey(e.target.value as SortKey)}>
        {SORT_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
    </div>
  )
}
