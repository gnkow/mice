import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'

export type SuggestOption = {
  value: string
  label: string
}

type Props = {
  name: string
  label: string
  value: string
  onChange: (value: string) => void
  options: SuggestOption[]
  placeholder?: string
  /** Accessible description when the field is empty (e.g. "All sessions"). */
  emptyHint?: string
}

/**
 * Text input with a filtered suggestion list. Free-text values are allowed so
 * filters keep working when the facet list is incomplete.
 */
export function SuggestField({
  name,
  label,
  value,
  onChange,
  options,
  placeholder,
  emptyHint,
}: Props) {
  const listId = useId()
  const wrapRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  const filtered = useMemo(() => {
    const needle = value.trim().toLowerCase()
    const pool = !needle
      ? options
      : options.filter(
          (o) =>
            o.label.toLowerCase().includes(needle) ||
            o.value.toLowerCase().includes(needle),
        )
    return pool.slice(0, 40)
  }, [options, value])

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDoc)
    return () => document.removeEventListener('pointerdown', onDoc)
  }, [])

  useEffect(() => {
    setActive(0)
  }, [value, options])

  function pick(next: string) {
    onChange(next)
    setOpen(false)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      setOpen(true)
      return
    }
    if (!open) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (filtered.length === 0) return
      setActive((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (filtered.length === 0) return
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && filtered[active]) {
      e.preventDefault()
      pick(filtered[active].value)
    }
  }

  return (
    <div className="suggest-field" ref={wrapRef}>
      <label>
        {label}
        <input
          name={name}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && filtered[active] ? `${listId}-${active}` : undefined}
          value={value}
          placeholder={placeholder ?? emptyHint ?? 'All'}
          autoComplete="off"
          onChange={(e) => {
            onChange(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
      </label>
      {open && (
        <ul id={listId} className="suggest-field-list" role="listbox" aria-label={`${label} suggestions`}>
          {filtered.length === 0 ? (
            <li className="suggest-field-empty muted small" role="presentation">
              {options.length === 0 ? 'No suggestions yet' : 'No matching suggestions'}
            </li>
          ) : (
            filtered.map((o, i) => (
              <li key={`${o.value}:${o.label}`} role="presentation">
                <button
                  type="button"
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={`suggest-field-option${i === active ? ' is-active' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onPointerDown={(e) => {
                    // Commit before blur; preventDefault keeps focus from racing the close.
                    e.preventDefault()
                    e.stopPropagation()
                    pick(o.value)
                  }}
                >
                  <span className="suggest-field-option-label">{o.label}</span>
                  {o.label !== o.value && (
                    <span className="suggest-field-option-value muted small">{o.value}</span>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
