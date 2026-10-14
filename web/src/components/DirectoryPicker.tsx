import { useEffect, useId, useRef, useState } from 'react'
import {
  searchDirectory,
  type DirectoryGroupHit,
  type DirectoryUserHit,
} from '../lib/authzApi'

type UserProps = {
  kind: 'user'
  sub: string
  iss: string
  onChange: (next: { sub: string; iss: string }) => void
  disabled?: boolean
  defaultIss?: string
}

type GroupProps = {
  kind: 'group'
  group: string
  onChange: (next: { group: string }) => void
  disabled?: boolean
}

type Props = UserProps | GroupProps

/**
 * Debounced IdP/store directory search with manual entry fallback.
 */
export function DirectoryPicker(props: Props) {
  const listId = useId()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [users, setUsers] = useState<DirectoryUserHit[]>([])
  const [groups, setGroups] = useState<DirectoryGroupHit[]>([])
  const [showManual, setShowManual] = useState(false)
  const [source, setSource] = useState<string>('none')
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  useEffect(() => {
    const q = query.trim()
    if (q.length < 1) {
      setUsers([])
      setGroups([])
      setError(null)
      return
    }
    const ac = new AbortController()
    const t = window.setTimeout(() => {
      setLoading(true)
      setError(null)
      void searchDirectory(q, props.kind, ac.signal)
        .then((res) => {
          setSource(res.source)
          if (props.kind === 'user') {
            setUsers(res.results.filter((r): r is DirectoryUserHit => r.kind === 'user'))
          } else {
            setGroups(
              res.results.filter((r): r is DirectoryGroupHit => r.kind === 'group'),
            )
          }
          setOpen(true)
        })
        .catch((err: unknown) => {
          if (ac.signal.aborted) return
          setError(err instanceof Error ? err.message : 'Search failed')
          setUsers([])
          setGroups([])
          setShowManual(true)
        })
        .finally(() => {
          if (!ac.signal.aborted) setLoading(false)
        })
    }, 280)
    return () => {
      ac.abort()
      window.clearTimeout(t)
    }
  }, [query, props.kind])

  const selectedLabel =
    props.kind === 'user'
      ? props.sub
        ? `${props.sub}${props.iss ? ` · ${props.iss}` : ''}`
        : ''
      : props.group

  return (
    <div className="directory-picker" ref={wrapRef}>
      <label className="directory-picker-search">
        Search directory
        <input
          type="search"
          value={query}
          disabled={props.disabled}
          placeholder={
            props.kind === 'user'
              ? 'Name, email, or username'
              : 'Group name'
          }
          autoComplete="off"
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={open}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => {
            if (query.trim()) setOpen(true)
          }}
        />
      </label>
      {selectedLabel ? (
        <p className="muted small directory-picker-selected">
          Selected: <code>{selectedLabel}</code>
        </p>
      ) : null}
      {loading && <p className="muted small">Searching…</p>}
      {error && <p className="error small">{error}</p>}
      {open && !loading && props.kind === 'user' && users.length > 0 && (
        <ul id={listId} className="directory-picker-list" role="listbox">
          {users.map((u) => (
            <li key={`${u.iss}\0${u.sub}`}>
              <button
                type="button"
                className="directory-picker-option"
                onClick={() => {
                  props.onChange({ sub: u.sub, iss: u.iss })
                  setQuery(u.email || u.name || u.sub)
                  setOpen(false)
                }}
              >
                <span className="directory-picker-option-name">
                  {u.name || u.email || u.sub}
                </span>
                <span className="muted small">
                  {u.email ? `${u.email} · ` : ''}
                  {u.sub}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && !loading && props.kind === 'group' && groups.length > 0 && (
        <ul id={listId} className="directory-picker-list" role="listbox">
          {groups.map((g) => (
            <li key={g.group}>
              <button
                type="button"
                className="directory-picker-option"
                onClick={() => {
                  props.onChange({ group: g.group })
                  setQuery(g.name || g.group)
                  setOpen(false)
                }}
              >
                <span className="directory-picker-option-name">{g.name}</span>
                <span className="muted small">IdP group</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open &&
        !loading &&
        query.trim() &&
        ((props.kind === 'user' && users.length === 0) ||
          (props.kind === 'group' && groups.length === 0)) && (
          <p className="muted small">
            No matches{source !== 'none' ? ` (${source})` : ''}. Use manual entry
            below.
          </p>
        )}

      <button
        type="button"
        className="btn ghost small directory-picker-manual-toggle"
        disabled={props.disabled}
        onClick={() => setShowManual((v) => !v)}
      >
        {showManual ? 'Hide manual entry' : 'Manual entry'}
      </button>

      {showManual && props.kind === 'user' && (
        <div className="directory-picker-manual ns-member-form-fields cols-2">
          <label>
            Subject (sub)
            <input
              required
              value={props.sub}
              disabled={props.disabled}
              onChange={(e) =>
                props.onChange({ sub: e.target.value, iss: props.iss })
              }
              placeholder="user-sub"
              autoComplete="off"
            />
          </label>
          <label>
            Issuer (iss)
            <input
              required
              value={props.iss}
              disabled={props.disabled}
              onChange={(e) =>
                props.onChange({ sub: props.sub, iss: e.target.value })
              }
              placeholder={props.defaultIss ?? 'boxen-dev'}
              autoComplete="off"
            />
          </label>
        </div>
      )}
      {showManual && props.kind === 'group' && (
        <div className="directory-picker-manual">
          <label>
            Group name
            <input
              required
              value={props.group}
              disabled={props.disabled}
              onChange={(e) => props.onChange({ group: e.target.value })}
              placeholder="engineering"
              autoComplete="off"
            />
          </label>
        </div>
      )}
    </div>
  )
}
