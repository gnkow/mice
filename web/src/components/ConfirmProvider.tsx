import { Check as ActionCheck, X as ActionX } from 'lucide-react'
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import {
  registerConfirmOpener,
  type ConfirmDeleteOptions,
} from '../lib/confirmDelete'

type Pending = {
  options: ConfirmDeleteOptions
  resolve: (ok: boolean) => void
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const [typed, setTyped] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const titleId = useId()
  const detailId = useId()
  const hintId = useId()
  const inputId = useId()

  useEffect(() => {
    registerConfirmOpener(
      (options) =>
        new Promise<boolean>((resolve) => {
          setTyped('')
          setPending({ options, resolve })
        }),
    )
    return () => registerConfirmOpener(null)
  }, [])

  useEffect(() => {
    if (!pending) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish(false)
    }
    window.addEventListener('keydown', onKey)
    const t = window.setTimeout(() => {
      if (pending.options.requireTypedConfirm !== false) {
        const el = inputRef.current
        if (el) {
          el.focus()
          el.select()
        }
      }
    }, 0)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending])

  function finish(ok: boolean) {
    pending?.resolve(ok)
    setPending(null)
    setTyped('')
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!pending) return
    const word = pending.options.confirmWord ?? 'DELETE'
    const needType = pending.options.requireTypedConfirm !== false
    if (needType && typed !== word) return
    finish(true)
  }

  const word = pending?.options.confirmWord ?? 'DELETE'
  const needType = pending?.options.requireTypedConfirm !== false
  const canConfirm = !needType || typed === word
  const mismatch = needType && typed.length > 0 && typed !== word

  return (
    <>
      {children}
      {pending && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) finish(false)
          }}
        >
          <form
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={detailId}
            onSubmit={onSubmit}
          >
            <h2 id={titleId} className="modal-title">
              {pending.options.title}
            </h2>
            <p id={detailId} className="muted">
              {pending.options.detail}
            </p>
            <p className="muted small">This cannot be undone.</p>
            {needType && (
              <div className="confirm-type">
                <label className="confirm-type-label" htmlFor={inputId}>
                  To confirm, type{' '}
                  <code className="confirm-type-word" title="Confirmation text">
                    {word}
                  </code>{' '}
                  below
                </label>
                <input
                  id={inputId}
                  ref={inputRef}
                  className={
                    mismatch
                      ? 'confirm-type-input confirm-type-input-mismatch'
                      : 'confirm-type-input'
                  }
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  onFocus={(e) => e.currentTarget.select()}
                  placeholder={word}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  aria-invalid={mismatch || undefined}
                  aria-describedby={hintId}
                />
                <p id={hintId} className="confirm-type-hint muted small">
                  {mismatch
                    ? 'Text does not match yet.'
                    : 'Exact match required, including capitalization.'}
                </p>
              </div>
            )}
            <div className="btn-row modal-actions">
              <button
                type="button"
                className="btn ghost"
                onClick={() => finish(false)}
              >
                <ActionX size={14} aria-hidden="true" className="button-label-icon" />Cancel
              </button>
              <button
                type="submit"
                className="btn danger"
                disabled={!canConfirm}
              >
                <ActionCheck size={14} aria-hidden="true" className="button-label-icon" />Confirm
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}
