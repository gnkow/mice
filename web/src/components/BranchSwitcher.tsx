import { useEffect, useMemo, useRef, useState } from 'react'

type Props = {
  branch: string
  branches: string[]
  disabled?: boolean
  onChange: (branch: string) => void
}

export function BranchSwitcher({
  branch,
  branches,
  disabled,
  onChange,
}: Props) {
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const [q, setQ] = useState('')

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return branches
    return branches.filter((b) => b.toLowerCase().includes(needle))
  }, [branches, q])

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const el = detailsRef.current
      if (!el?.open) return
      if (e.target instanceof Node && !el.contains(e.target)) {
        el.open = false
      }
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [])

  return (
    <details className="branch-switcher" ref={detailsRef}>
      <summary
        className="branch-switcher-summary"
        aria-label={`Current branch ${branch}`}
      >
        <svg
          className="branch-switcher-icon"
          width="14"
          height="14"
          viewBox="0 0 16 16"
          aria-hidden
        >
          <path
            fill="currentColor"
            d="M5 3.25a1.75 1.75 0 1 1-1.5 2.8v1.4A2.75 2.75 0 0 0 6.25 10.2h1.9v-.95a1.75 1.75 0 1 1 1.5 0v.95h1.1A2.75 2.75 0 0 0 13.5 7.45V5.95a1.75 1.75 0 1 1 1.5 0v1.5A4.25 4.25 0 0 1 10.75 11.7H9.65v1.05a1.75 1.75 0 1 1-1.5 0V11.7H6.25A4.25 4.25 0 0 1 2 7.45V6.05a1.75 1.75 0 0 1 3-1.8Z"
          />
        </svg>
        <span className="branch-switcher-name mono">{branch}</span>
        <span className="branch-switcher-caret" aria-hidden>
          ▾
        </span>
      </summary>
      <div className="branch-switcher-panel">
        <input
          type="search"
          className="branch-switcher-filter"
          placeholder="Find a branch…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          disabled={disabled}
        />
        <ul className="branch-switcher-list">
          {filtered.map((b) => (
            <li key={b}>
              <button
                type="button"
                className={
                  b === branch
                    ? 'branch-switcher-item active'
                    : 'branch-switcher-item'
                }
                disabled={disabled}
                onClick={() => {
                  onChange(b)
                  setQ('')
                  if (detailsRef.current) detailsRef.current.open = false
                }}
              >
                {b === branch ? '✓ ' : ''}
                {b}
              </button>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="muted small">No matching branches</li>
          )}
        </ul>
      </div>
    </details>
  )
}
