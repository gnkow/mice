import {
  Check as ActionCheck,
  ChevronLeft as ActionChevronLeft,
  ChevronRight as ActionChevronRight,
  Clock as ActionClock,
  KeyRound as ActionKeyRound,
  LogOut as ActionLogOut,
  ChevronDown as ActionChevronDown,
  Search as ActionSearch,
  ShieldCheck as ActionShieldCheck,
  X as ActionX,
} from 'lucide-react'
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import { fetchAuthzMe, logout } from '../lib/auth'
import {
  fetchOwnAccessRequest,
  submitAccessRequest,
  type AccessRequestRow,
} from '../lib/authzApi'
import { useAsync } from '../hooks/useAsync'
import {
  initialPendingShellView,
  pendingRequestAccessSummary,
  pendingShellViewAfterSubmit,
  type PendingShellView,
} from '../lib/pendingAccessShell'
import { groupPermissions } from '../lib/permissionPicker'
import {
  REQUESTABLE_ROLES,
  REQUESTABLE_ROLES_FOOTNOTE,
  buildAccessRequestPayload,
  togglePermission,
  type RequestAccessFormState,
  type RequestableRoleId,
} from '../lib/requestAccessForm'

function formFromPendingRequest(req: AccessRequestRow): RequestAccessFormState {
  const roleId = req.requestedRole
  const isRequestable =
    roleId != null && REQUESTABLE_ROLES.some((r) => r.id === roleId)
  if (isRequestable) {
    return {
      mode: 'role',
      role: roleId as RequestableRoleId,
      permissions: [],
      message: req.message,
    }
  }
  return {
    mode: 'custom',
    role: 'user',
    permissions: [...(req.requestedPermissions ?? [])],
    message: req.message,
  }
}

type FieldErrors = {
  message?: string
  permissions?: string
  summary?: string
}

type WizardStep = 1 | 2 | 3

const STEP_LABELS = ['Type', 'Access', 'Reason'] as const
/** Same 3-up step strip as the request wizard, after submit. */
const REVIEW_STEP_LABELS = ['Submitted', 'Review', 'Access'] as const

function fieldErrorsFromMessage(message: string): FieldErrors {
  if (message === 'Justification is required') {
    return { message, summary: message }
  }
  if (message === 'Select at least one permission') {
    return { permissions: message, summary: message }
  }
  return { summary: message }
}

/**
 * No-access shell (S32) + Request Access form (S33):
 * 3-step wizard, then pending confirmation. Sign out only.
 */
export function PendingAccessPage() {
  const catalog = useAsync((signal) => fetchAuthzMe(signal), [])
  const ownRequest = useAsync((signal) => fetchOwnAccessRequest(signal), [])
  const [view, setView] = useState<PendingShellView>('request')
  const [step, setStep] = useState<WizardStep>(1)
  const [form, setForm] = useState<RequestAccessFormState>({
    mode: 'role',
    role: 'user',
    permissions: [],
    message: '',
  })
  const [pendingRequest, setPendingRequest] = useState<AccessRequestRow | null>(
    null,
  )
  const [bootstrapped, setBootstrapped] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [busy, setBusy] = useState(false)
  const [permQuery, setPermQuery] = useState('')
  const [expandedResources, setExpandedResources] = useState<string[]>([])
  const deferredPermQuery = useDeferredValue(permQuery)
  const errorSummaryRef = useRef<HTMLDivElement>(null)
  const successRef = useRef<HTMLDivElement>(null)
  const filtering = deferredPermQuery.trim().length > 0
  const replacing = pendingRequest != null

  useEffect(() => {
    if (bootstrapped || ownRequest.kind === 'loading') return
    if (ownRequest.kind === 'ok') {
      const existing = ownRequest.data.request
      if (existing) {
        setPendingRequest(existing)
        setForm(formFromPendingRequest(existing))
        setView(initialPendingShellView(true))
      }
    }
    setBootstrapped(true)
  }, [ownRequest, bootstrapped])

  useEffect(() => {
    if (fieldErrors.summary) errorSummaryRef.current?.focus()
  }, [fieldErrors.summary])

  useEffect(() => {
    if (view === 'submitted') successRef.current?.focus()
  }, [view])

  function clearPermissionErrors() {
    setFieldErrors((prev) => ({
      ...prev,
      permissions: undefined,
      summary: undefined,
    }))
  }

  function setPermissionSelected(permission: string, next: boolean) {
    setForm((f) => {
      const has = f.permissions.includes(permission)
      if (next === has) return f
      return { ...f, permissions: togglePermission(f.permissions, permission) }
    })
    clearPermissionErrors()
  }

  function goNext() {
    if (step === 1) {
      setStep(2)
      return
    }
    if (step === 2) {
      if (form.mode === 'custom' && form.permissions.length === 0) {
        setFieldErrors(
          fieldErrorsFromMessage('Select at least one permission'),
        )
        return
      }
      setFieldErrors({})
      setStep(3)
    }
  }

  function goBack() {
    setFieldErrors({})
    if (step === 2) setStep(1)
    else if (step === 3) setStep(2)
  }

  async function onRequest(e: FormEvent) {
    e.preventDefault()
    if (step !== 3) {
      e.preventDefault()
      goNext()
      return
    }
    const built = buildAccessRequestPayload(form)
    if (!built.ok) {
      const errors = fieldErrorsFromMessage(built.error)
      setFieldErrors(errors)
      if (errors.permissions) setStep(2)
      return
    }
    setBusy(true)
    setFieldErrors({})
    try {
      const result = await submitAccessRequest(built.payload)
      setPendingRequest(result.request)
      setView(pendingShellViewAfterSubmit(view))
    } catch (err) {
      setFieldErrors({
        summary: err instanceof Error ? err.message : 'Request failed',
      })
    } finally {
      setBusy(false)
    }
  }

  function onSignOut() {
    void logout().then((r) => {
      if (r.idpLogoutUrl) window.location.href = r.idpLogoutUrl
      else window.location.href = '/login'
    })
  }

  function onUpdateRequest() {
    if (pendingRequest) setForm(formFromPendingRequest(pendingRequest))
    setStep(1)
    setFieldErrors({})
    setView('request')
  }

  const permissionCatalog =
    catalog.kind === 'ok' && catalog.data ? catalog.data.permissionCatalog : []
  const selectedCount = form.permissions.length
  const hasSummaryError = Boolean(fieldErrors.summary)
  const permissionGroups = useMemo(
    () => groupPermissions(permissionCatalog, deferredPermQuery),
    [permissionCatalog, deferredPermQuery],
  )
  const visibleCount = permissionGroups.reduce(
    (n, g) => n + g.permissions.length,
    0,
  )
  const formAccessSummary =
    form.mode === 'role'
      ? REQUESTABLE_ROLES.find((r) => r.id === form.role)?.label ?? form.role
      : `${selectedCount} permission${selectedCount === 1 ? '' : 's'}`
  const submittedAccessSummary = pendingRequest
    ? pendingRequestAccessSummary({
        requestedRole: pendingRequest.requestedRole,
        requestedPermissions: pendingRequest.requestedPermissions,
        roleLabel: REQUESTABLE_ROLES.find(
          (r) => r.id === pendingRequest.requestedRole,
        )?.label,
      })
    : formAccessSummary

  if (!bootstrapped) {
    return (
      <div className="login-shell">
        <main className="login-page pending-access pending-access-panel">
          <p className="login-brand">MICE</p>
          <p className="muted" role="status">
            Loading…
          </p>
        </main>
      </div>
    )
  }

  return (
    <div className="login-shell">
      <main className="login-page pending-access pending-access-panel">
        <p className="login-brand">MICE</p>
        {view === 'submitted' ? (
          <div
            ref={successRef}
            className="pending-access-success"
            role="status"
            tabIndex={-1}
            aria-labelledby="pending-access-success-title"
          >
            <div className="pending-access-intro">
              <div className="pending-access-hero-icon" aria-hidden="true">
                <ActionClock size={28} strokeWidth={1.75} />
              </div>
              <h1 id="pending-access-success-title">Request pending</h1>
              <p className="lede">
                Your request is with a manager or admin. You will get access
                after they approve it.
              </p>
            </div>

            <div className="pending-access-steps" aria-label="Request progress">
              <ol>
                {REVIEW_STEP_LABELS.map((label, i) => {
                  const n = i + 1
                  const current = n === 2
                  const done = n === 1
                  return (
                    <li
                      key={label}
                      className={`pending-access-step${current ? ' is-current' : ''}${done ? ' is-done' : ''}`}
                      aria-current={current ? 'step' : undefined}
                    >
                      <span className="pending-access-step-index" aria-hidden="true">
                        {done ? (
                          <ActionCheck size={12} strokeWidth={3} />
                        ) : current ? (
                          <ActionClock size={12} strokeWidth={2.25} />
                        ) : (
                          n
                        )}
                      </span>
                      <span className="pending-access-step-label">{label}</span>
                    </li>
                  )
                })}
              </ol>
              <p className="muted small pending-access-step-caption">
                Awaiting review
              </p>
            </div>

            <div className="pending-access-review">
              <p className="muted small">You requested</p>
              <p className="pending-access-review-value">
                {submittedAccessSummary}
              </p>
              {pendingRequest?.message ? (
                <p className="muted small pending-access-review-message">
                  {pendingRequest.message}
                </p>
              ) : null}
            </div>

            <p className="muted small pending-access-success-hint">
              Need a different role or permissions? Update this request — the
              new submission replaces the previous one.
            </p>

            <div className="btn-row pending-access-actions">
              <button type="button" className="btn ghost" onClick={onSignOut}>
                <ActionLogOut size={14} aria-hidden="true" className="button-label-icon" />
                Sign out
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={onUpdateRequest}
              >
                Update request
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="pending-access-intro">
              <div className="pending-access-hero-icon" aria-hidden="true">
                <ActionShieldCheck size={28} strokeWidth={1.75} />
              </div>
              <h1>{replacing ? 'Update request' : 'Request access'}</h1>
              <p className="lede">
                {replacing
                  ? 'Submit a new request to replace the one currently awaiting review.'
                  : 'You are signed in without a formal role. Complete the steps below to request access. Admin and Auditor are grant-only (separation of duties) — ask a manager to assign those.'}
              </p>
            </div>

            <div className="pending-access-steps" aria-label="Request steps">
              <ol>
                {STEP_LABELS.map((label, i) => {
                  const n = (i + 1) as WizardStep
                  const current = step === n
                  const done = step > n
                  return (
                    <li
                      key={label}
                      className={`pending-access-step${current ? ' is-current' : ''}${done ? ' is-done' : ''}`}
                      aria-current={current ? 'step' : undefined}
                    >
                      <span className="pending-access-step-index" aria-hidden="true">
                        {n}
                      </span>
                      <span className="pending-access-step-label">{label}</span>
                    </li>
                  )
                })}
              </ol>
              <p className="muted small pending-access-step-caption">
                Step {step} of {STEP_LABELS.length}
              </p>
            </div>

            <form className="form pending-access-form" onSubmit={onRequest} noValidate>
              {hasSummaryError && (
                <div
                  ref={errorSummaryRef}
                  id="pending-access-error-summary"
                  className="pending-access-error-summary"
                  role="alert"
                  tabIndex={-1}
                  aria-labelledby="pending-access-error-title"
                >
                  <h2 id="pending-access-error-title">There is a problem</h2>
                  <ul>
                    {fieldErrors.message ? (
                      <li>
                        <a href="#pending-access-justification">{fieldErrors.message}</a>
                      </li>
                    ) : null}
                    {fieldErrors.permissions ? (
                      <li>
                        <a href="#pending-access-permissions">{fieldErrors.permissions}</a>
                      </li>
                    ) : null}
                    {!fieldErrors.message &&
                    !fieldErrors.permissions &&
                    fieldErrors.summary ? (
                      <li>{fieldErrors.summary}</li>
                    ) : null}
                  </ul>
                </div>
              )}

              {step === 1 && (
                <fieldset className="pending-access-segment">
                  <legend>How do you want to request access?</legend>
                  <div className="pending-access-segment-options" role="presentation">
                    <label
                      className={`pending-access-choice${form.mode === 'role' ? ' is-selected' : ''}`}
                    >
                      <input
                        type="radio"
                        name="mode"
                        checked={form.mode === 'role'}
                        onChange={() => {
                          setForm((f) => ({ ...f, mode: 'role' }))
                          clearPermissionErrors()
                        }}
                      />
                      <span className="pending-access-choice-copy">
                        <strong>Formal role</strong>
                        <span className="muted small">
                          Recommended — a standard permission bundle
                        </span>
                      </span>
                    </label>
                    <label
                      className={`pending-access-choice${form.mode === 'custom' ? ' is-selected' : ''}`}
                    >
                      <input
                        type="radio"
                        name="mode"
                        checked={form.mode === 'custom'}
                        onChange={() => {
                          setForm((f) => ({ ...f, mode: 'custom' }))
                          setFieldErrors((prev) => ({
                            ...prev,
                            summary: undefined,
                          }))
                        }}
                      />
                      <span className="pending-access-choice-copy">
                        <strong>Custom permissions</strong>
                        <span className="muted small">
                          Advanced — pick individual capabilities
                        </span>
                      </span>
                    </label>
                  </div>
                </fieldset>
              )}

              {step === 2 && form.mode === 'role' && (
                <fieldset className="pending-access-roles">
                  <legend>Choose a role</legend>
                  <div className="pending-access-role-list">
                    {REQUESTABLE_ROLES.map((r) => (
                      <label
                        key={r.id}
                        className={`pending-access-role-card${form.role === r.id ? ' is-selected' : ''}`}
                      >
                        <input
                          type="radio"
                          name="role"
                          checked={form.role === r.id}
                          onChange={() => setForm((f) => ({ ...f, role: r.id }))}
                        />
                        <span className="pending-access-role-card-body">
                          <strong>{r.label}</strong>
                          <span className="muted small role-option-desc">
                            {r.description}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                  <p className="muted small" data-testid="requestable-roles-footnote">
                    {REQUESTABLE_ROLES_FOOTNOTE}
                  </p>
                </fieldset>
              )}

              {step === 2 && form.mode === 'custom' && (
                <fieldset
                  id="pending-access-permissions"
                  className={`pending-access-perms${fieldErrors.permissions ? ' is-invalid' : ''}`}
                  aria-invalid={fieldErrors.permissions ? true : undefined}
                  aria-describedby={
                    fieldErrors.permissions
                      ? 'pending-access-permissions-error'
                      : 'pending-access-permissions-hint'
                  }
                >
                  <legend>Select permissions</legend>

                  <div className="perm-picker-filter">
                    <ActionSearch size={15} aria-hidden="true" />
                    <input
                      id="pending-access-perm-search"
                      type="search"
                      value={permQuery}
                      onChange={(e) => setPermQuery(e.target.value)}
                      placeholder="Filter permissions…"
                      autoComplete="off"
                      disabled={catalog.kind !== 'ok'}
                      aria-label="Filter permissions"
                    />
                    {permQuery ? (
                      <button
                        type="button"
                        className="perm-picker-filter-clear"
                        onClick={() => setPermQuery('')}
                        aria-label="Clear filter"
                      >
                        <ActionX size={14} aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>

                  <div className="perm-picker-selected" aria-live="polite">
                    <div className="perm-picker-selected-head">
                      <p id="pending-access-permissions-hint" className="muted small">
                        {catalog.kind === 'loading'
                          ? 'Loading catalog…'
                          : filtering
                            ? `${visibleCount} match${visibleCount === 1 ? '' : 'es'} · ${selectedCount} selected`
                            : `${selectedCount} selected of ${permissionCatalog.length}`}
                      </p>
                      {selectedCount > 0 ? (
                        <button
                          type="button"
                          className="linkish"
                          onClick={() => {
                            setForm((f) => ({ ...f, permissions: [] }))
                            clearPermissionErrors()
                          }}
                        >
                          Clear selected
                        </button>
                      ) : null}
                    </div>
                    {selectedCount > 0 ? (
                      <ul className="perm-picker-selected-list">
                        {form.permissions.map((perm) => (
                          <li key={perm}>
                            <code>{perm}</code>
                            <button
                              type="button"
                              className="perm-picker-selected-remove"
                              onClick={() => setPermissionSelected(perm, false)}
                              aria-label={`Remove ${perm}`}
                            >
                              <ActionX size={12} aria-hidden="true" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted small perm-picker-selected-empty">
                        Nothing selected yet. Open a group or filter to choose.
                      </p>
                    )}
                  </div>

                  {catalog.kind === 'error' && (
                    <p className="flash flash-error" role="alert">
                      Could not load the permission catalog.
                    </p>
                  )}

                  <div className="perm-picker-list perm-picker-list-compact">
                    {catalog.kind === 'ok' && permissionGroups.length === 0 && (
                      <p className="muted small perm-picker-empty">
                        No matches for “{deferredPermQuery.trim()}”. Try{' '}
                        <code>repo</code> or <code>read</code>.
                      </p>
                    )}
                    {permissionGroups.map((group) => {
                      const selectedInGroup = group.permissions.filter((p) =>
                        form.permissions.includes(p),
                      ).length
                      const open =
                        filtering || expandedResources.includes(group.resource)
                      return (
                        <section
                          key={group.resource}
                          className={`perm-picker-group${open ? ' is-open' : ''}`}
                        >
                          <button
                            type="button"
                            id={`perm-group-${group.resource}`}
                            className="perm-picker-group-toggle"
                            aria-expanded={open}
                            aria-controls={`perm-group-panel-${group.resource}`}
                            onClick={() =>
                              setExpandedResources((prev) =>
                                prev.includes(group.resource)
                                  ? prev.filter((r) => r !== group.resource)
                                  : [...prev, group.resource],
                              )
                            }
                          >
                            <ActionChevronDown
                              size={14}
                              className="perm-picker-group-chevron"
                              aria-hidden="true"
                            />
                            <span>{group.label}</span>
                            <span className="muted small perm-picker-group-meta">
                              {selectedInGroup > 0
                                ? `${selectedInGroup}/${group.permissions.length}`
                                : group.permissions.length}
                            </span>
                          </button>
                          {open ? (
                            <div
                              id={`perm-group-panel-${group.resource}`}
                              className="perm-picker-group-items"
                              role="group"
                              aria-labelledby={`perm-group-${group.resource}`}
                            >
                              {group.permissions.map((perm) => {
                                const selected = form.permissions.includes(perm)
                                return (
                                  <label
                                    key={perm}
                                    className={`perm-picker-item${selected ? ' is-selected' : ''}`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={selected}
                                      onChange={(e) =>
                                        setPermissionSelected(perm, e.target.checked)
                                      }
                                    />
                                    <code className="perm-picker-item-id">{perm}</code>
                                  </label>
                                )
                              })}
                            </div>
                          ) : null}
                        </section>
                      )
                    })}
                  </div>
                  {fieldErrors.permissions ? (
                    <p
                      id="pending-access-permissions-error"
                      className="field-error"
                      role="alert"
                    >
                      {fieldErrors.permissions}
                    </p>
                  ) : null}
                </fieldset>
              )}

              {step === 3 && (
                <>
                  <div className="pending-access-review">
                    <p className="muted small">You are requesting</p>
                    <p className="pending-access-review-value">{formAccessSummary}</p>
                  </div>
                  <div
                    className={`pending-access-justification${fieldErrors.message ? ' is-invalid' : ''}`}
                  >
                    <label htmlFor="pending-access-justification">
                      Justification
                      <span className="pending-access-required"> (required)</span>
                    </label>
                    <textarea
                      id="pending-access-justification"
                      value={form.message}
                      onChange={(e) => {
                        setForm((f) => ({ ...f, message: e.target.value }))
                        setFieldErrors((prev) => ({
                          ...prev,
                          message: undefined,
                          summary: undefined,
                        }))
                      }}
                      rows={4}
                      placeholder="What work do you need to do, and why this level of access?"
                      required
                      aria-invalid={fieldErrors.message ? true : undefined}
                      aria-describedby={
                        fieldErrors.message
                          ? 'pending-access-justification-error'
                          : 'pending-access-justification-hint'
                      }
                    />
                    <p id="pending-access-justification-hint" className="muted small">
                      Reviewers use this to decide whether to approve your request.
                    </p>
                    {fieldErrors.message ? (
                      <p
                        id="pending-access-justification-error"
                        className="field-error"
                        role="alert"
                      >
                        {fieldErrors.message}
                      </p>
                    ) : null}
                  </div>
                </>
              )}

              <div className="btn-row pending-access-actions">
                {step > 1 ? (
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={goBack}
                    disabled={busy}
                  >
                    <ActionChevronLeft size={14} aria-hidden="true" className="button-label-icon" />
                    Back
                  </button>
                ) : (
                  <button type="button" className="btn ghost" onClick={onSignOut}>
                    <ActionLogOut size={14} aria-hidden="true" className="button-label-icon" />
                    Sign out
                  </button>
                )}
                {step < 3 ? (
                  <button type="submit" className="btn primary">
                    Continue
                    <ActionChevronRight size={14} aria-hidden="true" className="button-label-icon" />
                  </button>
                ) : (
                  <button
                    className="btn primary"
                    type="submit"
                    disabled={busy || (form.mode === 'custom' && catalog.kind !== 'ok')}
                    aria-busy={busy || undefined}
                  >
                    <ActionKeyRound
                      size={16}
                      aria-hidden="true"
                      className="button-label-icon"
                    />
                    {busy
                      ? replacing
                        ? 'Updating…'
                        : 'Submitting…'
                      : replacing
                        ? 'Update request'
                        : 'Request access'}
                  </button>
                )}
              </div>
            </form>
          </>
        )}
      </main>
    </div>
  )
}
