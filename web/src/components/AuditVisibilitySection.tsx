import {
  ChevronLeft as ActionChevronLeft,
  ChevronRight as ActionChevronRight,
  Eye,
  Save as ActionSave,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useAsync } from '../hooks/useAsync'
import {
  fetchAuditVisibility,
  resetAuditVisibilityDefaults,
  saveAuditVisibility,
  type AuditVisibilityAction,
} from '../lib/authzApi'

function groupActions(actions: AuditVisibilityAction[]) {
  const groups = new Map<string, AuditVisibilityAction[]>()
  for (const a of actions) {
    const list = groups.get(a.group) ?? []
    list.push(a)
    groups.set(a.group, list)
  }
  return [...groups.entries()]
}

function groupSlug(group: string) {
  return group.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

function tabId(group: string) {
  return `audit-visibility-tab-${groupSlug(group)}`
}

function panelId(group: string) {
  return `audit-visibility-panel-${groupSlug(group)}`
}

/** Instance admin: choose which ledger actions Auditors see in list/export. */
export function AuditVisibilitySection() {
  const state = useAsync((signal) => fetchAuditVisibility(signal), [])
  const [visible, setVisible] = useState<Set<string> | null>(null)
  const [activeGroup, setActiveGroup] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const tabStripRef = useRef<HTMLDivElement>(null)

  const loaded = state.kind === 'ok' ? state.data : null

  useEffect(() => {
    if (!loaded) return
    setVisible(new Set(loaded.actions.filter((a) => a.visible).map((a) => a.value)))
  }, [loaded])

  const actions = loaded?.actions ?? []
  const groups = useMemo(() => groupActions(actions), [actions])

  useEffect(() => {
    if (groups.length === 0) return
    setActiveGroup((cur) => (cur && groups.some(([name]) => name === cur) ? cur : groups[0]![0]))
  }, [groups])

  function updateTabScrollState() {
    const el = tabStripRef.current
    if (!el) {
      setCanScrollLeft(false)
      setCanScrollRight(false)
      return
    }
    const max = el.scrollWidth - el.clientWidth
    setCanScrollLeft(el.scrollLeft > 2)
    setCanScrollRight(max > 2 && el.scrollLeft < max - 2)
  }

  useLayoutEffect(() => {
    const el = tabStripRef.current
    if (!el) return
    updateTabScrollState()
    const onScroll = () => updateTabScrollState()
    el.addEventListener('scroll', onScroll, { passive: true })
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => updateTabScrollState()) : null
    ro?.observe(el)
    return () => {
      el.removeEventListener('scroll', onScroll)
      ro?.disconnect()
    }
  }, [groups, visible])

  useEffect(() => {
    if (!activeGroup) return
    const btn = document.getElementById(tabId(activeGroup))
    btn?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' })
  }, [activeGroup])

  function scrollTabs(dir: -1 | 1) {
    const el = tabStripRef.current
    if (!el) return
    el.scrollBy({ left: dir * Math.max(160, el.clientWidth * 0.7), behavior: 'smooth' })
  }

  const dirty =
    visible !== null &&
    loaded !== null &&
    (visible.size !== loaded.actions.filter((a) => a.visible).length ||
      loaded.actions.some((a) => a.visible !== visible.has(a.value)))

  const activeItems = useMemo(() => {
    if (!activeGroup) return []
    return groups.find(([name]) => name === activeGroup)?.[1] ?? []
  }, [groups, activeGroup])

  function toggle(value: string) {
    setVisible((prev) => {
      const next = new Set(prev ?? [])
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return next
    })
    setSaved(false)
  }

  function setGroup(group: AuditVisibilityAction[], on: boolean) {
    setVisible((prev) => {
      const next = new Set(prev ?? [])
      for (const a of group) {
        if (on) next.add(a.value)
        else next.delete(a.value)
      }
      return next
    })
    setSaved(false)
  }

  async function persist(
    run: () => Promise<{ actions: AuditVisibilityAction[] }>,
  ) {
    setSaving(true)
    setError(null)
    try {
      const next = await run()
      setVisible(new Set(next.actions.filter((a) => a.visible).map((a) => a.value)))
      state.reload()
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function onSave(e: FormEvent) {
    e.preventDefault()
    if (!visible || !loaded) return
    const hiddenActions = loaded.actions
      .map((a) => a.value)
      .filter((value) => !visible.has(value))
    await persist(() => saveAuditVisibility(hiddenActions))
  }

  async function onResetDefaults() {
    await persist(() => resetAuditVisibilityDefaults())
  }

  const allOn = activeItems.length > 0 && activeItems.every((a) => visible?.has(a.value))
  const noneOn = activeItems.length > 0 && activeItems.every((a) => !visible?.has(a.value))

  return (
    <section id="audit-visibility" className="settings-section" aria-labelledby="audit-visibility-heading">
      <div className="ns-settings-section-head">
        <div>
          <h2 id="audit-visibility-heading">
            <Eye size={18} className="button-label-icon" aria-hidden="true" />
            Audit Visibility
          </h2>
          <p className="muted small">
            Choose which operations Auditors see in the audit log and exports. Unchecked actions stay
            on the ledger; they are only hidden from Auditor views.
            {state.kind === 'ok' && state.data.usingDefaults
              ? ' Showing product defaults (login, session noise, audit browse, and similar are hidden).'
              : null}
          </p>
        </div>
      </div>

      {state.kind === 'loading' && visible === null ? (
        <p className="muted small" aria-live="polite">
          Loading…
        </p>
      ) : null}
      {state.kind === 'error' ? (
        <p className="form-error" role="alert">
          {state.message}
        </p>
      ) : null}

      {visible && groups.length > 0 && activeGroup ? (
        <form onSubmit={onSave} className="stack gap-md">
          <div className="audit-visibility-tab-carousel">
            <button
              type="button"
              className="btn ghost small audit-visibility-tab-nav"
              aria-label="Previous operation groups"
              disabled={!canScrollLeft}
              onClick={() => scrollTabs(-1)}
            >
              <ActionChevronLeft size={16} aria-hidden="true" />
            </button>
            <div
              ref={tabStripRef}
              className="tab-bar audit-visibility-tab-strip"
              role="tablist"
              aria-label="Audit operation groups"
            >
              {groups.map(([group, items]) => {
                const hiddenCount = items.filter((a) => !visible.has(a.value)).length
                return (
                  <button
                    key={group}
                    type="button"
                    role="tab"
                    id={tabId(group)}
                    aria-selected={activeGroup === group}
                    aria-controls={panelId(group)}
                    className={activeGroup === group ? 'active' : ''}
                    onClick={() => setActiveGroup(group)}
                  >
                    {group}
                    {hiddenCount > 0 ? (
                      <span className="muted small"> ({hiddenCount} hidden)</span>
                    ) : null}
                  </button>
                )
              })}
            </div>
            <button
              type="button"
              className="btn ghost small audit-visibility-tab-nav"
              aria-label="Next operation groups"
              disabled={!canScrollRight}
              onClick={() => scrollTabs(1)}
            >
              <ActionChevronRight size={16} aria-hidden="true" />
            </button>
          </div>

          <div
            role="tabpanel"
            id={panelId(activeGroup)}
            aria-labelledby={tabId(activeGroup)}
            className="stack gap-sm"
          >
            <div className="btn-row">
              <button
                type="button"
                className="btn ghost small"
                onClick={() => setGroup(activeItems, true)}
                disabled={allOn}
              >
                Show all
              </button>
              <button
                type="button"
                className="btn ghost small"
                onClick={() => setGroup(activeItems, false)}
                disabled={noneOn}
              >
                Hide all
              </button>
            </div>
            <ul className="stack gap-xs" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {activeItems.map((a) => (
                <li key={a.value}>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={visible.has(a.value)}
                      onChange={() => toggle(a.value)}
                    />
                    <span>
                      {a.label}{' '}
                      <code className="muted small mono">{a.value}</code>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          {saved && !dirty ? (
            <p className="muted small" role="status">
              Saved. Auditors will no longer see unchecked operations.
            </p>
          ) : null}

          <div className="btn-row">
            <button type="submit" className="btn primary" disabled={saving || !dirty}>
              <ActionSave size={14} aria-hidden="true" className="button-label-icon" />
              {saving ? 'Saving…' : 'Save visibility'}
            </button>
            <button
              type="button"
              className="btn ghost"
              disabled={saving}
              onClick={() => void onResetDefaults()}
            >
              Reset to defaults
            </button>
          </div>
        </form>
      ) : null}
    </section>
  )
}
