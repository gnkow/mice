import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { decideCommitEmailDisplay } from '../lib/commitEmail'
import {
  decideUserRefLabel,
  decideUserRefUsername,
  parsePrincipalAuthor,
} from '../lib/userRef'
import { AuthorAvatar } from './AuthorAvatar'
import { UserInfo } from './UserInfo'

type Profiles = {
  emails?: Record<string, string>
  names?: Record<string, string>
}

type PanelPos = { top: number; left: number }

/** Compact Principal reference: avatar + username; click opens UserInfo. */
export function UserRef({
  author,
  storedEmail,
  profiles,
  className,
}: {
  author: string
  storedEmail?: string | null
  profiles?: Profiles
  className?: string
}) {
  const key = author.trim()
  const parsed = parsePrincipalAuthor(key)
  const name = profiles?.names?.[key]
  const currentEmail = profiles?.emails?.[key]
  const emailDisplay = decideCommitEmailDisplay(
    storedEmail ?? undefined,
    currentEmail,
  )
  const emailForLabel = emailDisplay?.email ?? storedEmail ?? currentEmail
  const label = decideUserRefLabel({
    author: key || 'unknown',
    name,
    email: emailForLabel,
  })
  const username = decideUserRefUsername({
    author: key || 'unknown',
    email: emailForLabel,
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
      // Prefer below; flip above when clipped by the viewport bottom.
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

  return (
    <span
      className={['user-ref', className].filter(Boolean).join(' ')}
      ref={rootRef}
      data-testid="user-ref"
    >
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
        <AuthorAvatar name={label} />
        <span className="user-ref-label">{label}</span>
      </button>
      {open
        ? createPortal(
            <div
              ref={panelRef}
              id={panelId}
              className="user-ref-panel"
              data-testid="user-ref-panel"
              style={
                pos
                  ? { top: pos.top, left: pos.left }
                  : { top: -9999, left: -9999 }
              }
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <UserInfo
                name={name}
                username={username}
                email={emailDisplay?.email ?? storedEmail}
                currentEmail={emailDisplay?.current}
                iss={parsed?.iss}
                sub={parsed?.sub}
              />
            </div>,
            document.body,
          )
        : null}
    </span>
  )
}
