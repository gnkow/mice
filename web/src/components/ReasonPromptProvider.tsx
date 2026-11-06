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
  REASON_CATEGORIES,
  registerReasonOpener,
  type ReasonCategoryValue,
  type ReasonPromptOptions,
  type ReasonSubmission,
} from '../lib/reasonPrompt'

type Pending = {
  options: ReasonPromptOptions
  resolve: (value: ReasonSubmission | null) => void
}

const PLACEHOLDER =
  'e.g. Corrected assay plate layout after deviation DEV-12'

const GXP_NOTICE =
  'Under GxP, who made this change and why is permanently recorded in the audit trail (not editable or deletable). That is separate from the entity’s own version history of successive states.'

export function ReasonPromptProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const [category, setCategory] = useState<ReasonCategoryValue>('data_correction')
  const [reason, setReason] = useState('')
  const [changeControlId, setChangeControlId] = useState('')
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  const titleId = useId()
  const changeId = useId()
  const noticeId = useId()
  const categoryId = useId()
  const reasonId = useId()
  const ccId = useId()

  useEffect(() => {
    registerReasonOpener(
      (options) =>
        new Promise<ReasonSubmission | null>((resolve) => {
          setCategory('data_correction')
          setReason('')
          setChangeControlId('')
          setPending({ options, resolve })
        }),
    )
    return () => registerReasonOpener(null)
  }, [])

  useEffect(() => {
    if (!pending) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish(null)
    }
    window.addEventListener('keydown', onKey)
    const t = window.setTimeout(() => reasonRef.current?.focus(), 0)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending])

  function finish(value: ReasonSubmission | null) {
    pending?.resolve(value)
    setPending(null)
    setReason('')
    setChangeControlId('')
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const text = reason.trim()
    const cc = changeControlId.trim()
    if (!text || !category || !cc) return
    finish({ reason: text, category, changeControlId: cc })
  }

  const canConfirm = reason.trim().length > 0 && changeControlId.trim().length > 0

  return (
    <>
      {children}
      {pending && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) finish(null)
          }}
        >
          <form
            className="modal reason-prompt"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={`${changeId} ${noticeId}`}
            onSubmit={onSubmit}
          >
            <h2 id={titleId} className="modal-title">
              Reason required
            </h2>

            <section className="reason-prompt-change" aria-labelledby={changeId}>
              <h3 id={changeId} className="reason-prompt-heading">
                What will change
              </h3>
              <p className="reason-prompt-summary">{pending.options.changeSummary}</p>
            </section>

            <p id={noticeId} className="reason-prompt-notice muted small">
              {GXP_NOTICE}
            </p>

            {pending.options.detail ? (
              <p className="reason-prompt-server muted small">{pending.options.detail}</p>
            ) : null}

            <label className="reason-prompt-label" htmlFor={categoryId}>
              Category
              <select
                id={categoryId}
                value={category}
                onChange={(e) => setCategory(e.target.value as ReasonCategoryValue)}
                required
              >
                {REASON_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="reason-prompt-label" htmlFor={reasonId}>
              Reason
              <textarea
                id={reasonId}
                ref={reasonRef}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={PLACEHOLDER}
                rows={4}
                required
                autoComplete="off"
              />
            </label>

            <label className="reason-prompt-label" htmlFor={ccId}>
              Change-control id
              <input
                id={ccId}
                type="text"
                value={changeControlId}
                onChange={(e) => setChangeControlId(e.target.value)}
                placeholder="e.g. CC-2026-114"
                required
                autoComplete="off"
              />
            </label>

            <div className="btn-row modal-actions">
              <button type="button" className="btn ghost" onClick={() => finish(null)}>
                <ActionX size={14} aria-hidden="true" className="button-label-icon" />
                Cancel
              </button>
              <button type="submit" className="btn primary" disabled={!canConfirm}>
                <ActionCheck size={14} aria-hidden="true" className="button-label-icon" />
                Confirm and continue
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}
