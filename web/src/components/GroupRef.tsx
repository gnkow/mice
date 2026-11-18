import { UsersRound } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { decideGroupRefLabel } from '../lib/groupRef'
import { GroupInfo } from './GroupInfo'

type PanelPos = { top: number; left: number }

/** Compact IdP group reference: group icon + name; click opens GroupInfo. */
export function GroupRef({
  bindingKey,
  displayName,
  className,
  interactive = true,
}: {
  bindingKey: string
  displayName?: string | null
  className?: string
  /** When false, render a static chip (safe inside another button). */
  interactive?: boolean
}) {
  const label = decideGroupRefLabel({
    bindingKey: bindingKey.trim() || 'unknown',
    displayName,
  })
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<PanelPos | null>(null)
  const rootRef = useRef<HTMLSpanElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const panelId = useId()

  useLayoutEffect(() => {
    if (!open || !rootRef.current) {
      setPos(null)
      return
    }
    function place() {
      const trigger = rootRef.current
      if (!trigger) return
      const rect = trigger.getBoundingClientRect()
      const gap = 6
      const panelWidth = Math.min(352, window.innerWidth - 16)
      let left = rect.left
      if (left + panelWidth > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - panelWidth - 8)
      }
      const below = rect.bottom + gap
      const panelHeight = panelRef.current?.offsetHeight ?? 160
      const top =
        below + panelHeight > window.innerHeight - 8
          ? Math.max(8, rect.top - gap - panelHeight)
          : below
      setPos({ top, left })
    }
    place()
    const raf = requestAnimationFrame(place)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      const t = e.target as Node
      if (rootRef.current?.contains(t) || panelRef.current?.contains(t)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const chip = (
    <>
      <span className="avatar-circle group-ref-avatar" aria-hidden="true" title={label}>
        <UsersRound size={14} strokeWidth={2.25} />
      </span>
      <span className="group-ref-label user-ref-label">{label}</span>
    </>
  )

  return (
    <span
      className={['group-ref', 'user-ref', className].filter(Boolean).join(' ')}
      ref={rootRef}
      data-testid="group-ref"
    >
      {interactive ? (
        <button
          type="button"
          className="user-ref-trigger"
          aria-expanded={open}
          aria-controls={panelId}
          aria-haspopup="dialog"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setOpen((v) => !v)
          }}
        >
          {chip}
        </button>
      ) : (
        <span className="user-ref-trigger user-ref-static">{chip}</span>
      )}
      {interactive && open
        ? createPortal(
            <div
              ref={panelRef}
              id={panelId}
              className="user-ref-panel"
              data-testid="group-ref-panel"
              style={
                pos
                  ? { top: pos.top, left: pos.left }
                  : { top: -9999, left: -9999 }
              }
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <GroupInfo displayName={displayName} bindingKey={bindingKey} />
            </div>,
            document.body,
          )
        : null}
    </span>
  )
}
