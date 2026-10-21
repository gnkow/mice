import { GitBranch as ActionGitBranch } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { GitBranch } from 'lucide-react'

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
        <GitBranch
          className="branch-switcher-icon"
          size={14}
        />
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
                <ActionGitBranch size={14} aria-hidden="true" className="button-label-icon" />{b === branch ? '✓ ' : ''}
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
