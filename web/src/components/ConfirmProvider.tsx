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
        inputRef.current?.focus()
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
            onSubmit={onSubmit}
          >
            <h2 id={titleId} className="modal-title">
              {pending.options.title}
            </h2>
            <p className="muted">{pending.options.detail}</p>
            <p className="muted small">This cannot be undone.</p>
            {needType && (
              <label>
                Type <code>{word}</code> to confirm
                <input
                  ref={inputRef}
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
            )}
            <div className="btn-row modal-actions">
              <button
                type="button"
                className="btn ghost"
                onClick={() => finish(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn danger"
                disabled={!canConfirm}
              >
                Confirm
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}
