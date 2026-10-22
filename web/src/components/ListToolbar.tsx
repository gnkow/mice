import { Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { SortControl, type useListSort } from './SortControl'

type Props = {
  id: string
  sort: Pick<ReturnType<typeof useListSort<never>>, 'sortKey' | 'setKey'>
  search: {
    value: string
    onChange: (value: string) => void
    placeholder?: string
    disabled?: boolean
    /** Called on Enter, blur and clear, for pages that apply the search lazily. */
    onCommit?: (value: string) => void
  }
  /** Extra filters rendered after the search field. */
  children?: ReactNode
  meta?: ReactNode
}

/** Shared sort + search (+ filters) toolbar used by every listing. */
export function ListToolbar({ id, sort, search, children, meta }: Props) {
  return (
    <div className="ns-toolbar" role="search">
      <SortControl id={id} sort={sort} />
      <div className="ns-search-field">
        <label className="ns-search-label" htmlFor={`${id}-filter`}>Search</label>
        <div className="ns-search-control">
          <span className="ns-search-icon" aria-hidden>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </span>
          <input
            id={`${id}-filter`}
            type="search"
            value={search.value}
            disabled={search.disabled}
            onChange={(e) => search.onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && search.onCommit) {
                e.preventDefault()
                search.onCommit(search.value)
              }
            }}
            onBlur={() => search.onCommit?.(search.value)}
            placeholder={search.placeholder ?? 'Filter by name'}
            autoComplete="off"
          />
          {search.value.trim() ? (
            <button
              type="button"
              className="ns-search-clear"
              onClick={() => {
                search.onChange('')
                search.onCommit?.('')
              }}
              aria-label="Clear search"
            >
              <Trash2 size={14} aria-hidden="true" className="button-label-icon" />Clear
            </button>
          ) : null}
        </div>
      </div>
      {children}
      {meta ? <p className="muted small ns-toolbar-meta">{meta}</p> : null}
    </div>
  )
}
