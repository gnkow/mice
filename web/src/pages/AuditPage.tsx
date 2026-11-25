import {
  AlertTriangle,
  Check,
  Clock,
  Download as ActionDownload,
  FileSignature as ActionFileSignature,
  FileText as ActionFileText,
  Search as ActionSearch,
  ShieldCheck as ActionShieldCheck,
  ShieldOff,
  Trash2 as ActionTrash2,
  X,
} from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Modal } from '../components/Modal'
import { StateBlock } from '../components/StateBlock'
import { SuggestField, type SuggestOption } from '../components/SuggestField'
import { useAsync } from '../hooks/useAsync'
import {
  actionLabel,
  eventResources,
  resourceUriHref,
  AuditDeniedError,
  exportAudit,
  fetchAuditFacets,
  agedOrphanIntentEvents,
  loadAudit,
  unpairedIntentEvents,
  verifyAuditChain,
  type AuditEvent,
  type AuditExportFormat,
  type AuditFacets,
  type AuditFocus,
  type AuditResource,
  type AuditVerifyResult,
} from '../lib/audit'
import { signatureEvidenceSections } from '../lib/signatureEvidence'
import { revocableSignatureId, revokedSignatureIds } from '../lib/signatureRevoke'

const FILTER_KEYS = [
  'since',
  'until',
  'actor',
  'namespace',
  'repo',
  'action',
  'session_id',
  'workspace_id',
  'job_id',
] as const
type FilterKey = (typeof FILTER_KEYS)[number]
type Draft = Record<FilterKey, string>

/** `datetime-local` value ↔ ISO for `since` / `until` query params. */
function isoToLocalInput(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function localInputToIso(local: string): string | undefined {
  const v = local.trim()
  if (!v) return undefined
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return undefined
  return d.toISOString()
}

/** Investigation Focus presets (#155) — server `?focus=` (not raw action prefixes). */
const INVESTIGATION_PRESETS: readonly {
  id: 'signatures' | 'files' | 'merges' | 'roles'
  label: string
  title: string
}[] = [
  {
    id: 'signatures',
    label: 'Signatures',
    title: 'Show signed mutations and esign.* ceremony events',
  },
  {
    id: 'files',
    label: 'Files',
    title: 'Show file write/delete events',
  },
  {
    id: 'merges',
    label: 'Merges',
    title: 'Show branch merges and merge-request events',
  },
  {
    id: 'roles',
    label: 'Roles',
    title: 'Show instance role assign/revoke events',
  },
]

function draftFromParams(p: URLSearchParams): Draft {
  return Object.fromEntries(
    FILTER_KEYS.map((k) => {
      const raw = p.get(k) ?? ''
      if ((k === 'since' || k === 'until') && raw) return [k, isoToLocalInput(raw)]
      return [k, raw]
    }),
  ) as Draft
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id
}

function resourceSuggestOptions(options: AuditResource[]): SuggestOption[] {
  return options.map((r) => {
    const where = r.repo
      ? ` · ${r.namespace ?? ''}/${r.repo}`
      : r.namespace
        ? ` · ${r.namespace}`
        : ''
    const head = r.label && r.label !== r.id ? `${r.label} · ${shortId(r.id)}` : shortId(r.id)
    return { value: r.id, label: `${head}${where} (${r.count})` }
  })
}

function stringSuggestOptions(options: AuditResource[]): SuggestOption[] {
  return options.map((r) => ({
    value: r.id,
    label: r.count > 1 ? `${r.id} (${r.count})` : r.id,
  }))
}

function actorSuggestOptions(options: AuditResource[]): SuggestOption[] {
  return options.map((r) => ({
    value: r.id,
    label: r.label && r.label !== r.id ? `${r.label} · ${r.id} (${r.count})` : `${r.id} (${r.count})`,
  }))
}

function mergeSuggestOptions(...groups: SuggestOption[][]): SuggestOption[] {
  const map = new Map<string, SuggestOption>()
  for (const group of groups) {
    for (const o of group) {
      if (!map.has(o.value)) map.set(o.value, o)
    }
  }
  return [...map.values()]
}

/** Fallback suggestions from the currently loaded page when facets are empty. */
function suggestFromEvents(events: AuditEvent[]): {
  actors: SuggestOption[]
  namespaces: SuggestOption[]
  repos: SuggestOption[]
  sessions: SuggestOption[]
  workspaces: SuggestOption[]
  jobs: SuggestOption[]
} {
  const actors = new Map<string, string>()
  const namespaces = new Set<string>()
  const repos = new Set<string>()
  const sessions = new Set<string>()
  const workspaces = new Set<string>()
  const jobs = new Set<string>()
  for (const e of events) {
    const actorKey = e.actor.email || e.actor.sub
    if (actorKey) actors.set(actorKey, e.actor.name || actorKey)
    if (e.namespace) namespaces.add(e.namespace)
    if (e.repo) repos.add(e.repo)
    const r = eventResources(e)
    if (r.sessionId) sessions.add(r.sessionId)
    if (r.workspaceId) workspaces.add(r.workspaceId)
    for (const j of r.jobIds) jobs.add(j)
  }
  return {
    actors: [...actors.entries()].map(([value, name]) => ({
      value,
      label: name !== value ? `${name} · ${value}` : value,
    })),
    namespaces: [...namespaces].map((value) => ({ value, label: value })),
    repos: [...repos].map((value) => ({ value, label: value })),
    sessions: [...sessions].map((value) => ({ value, label: shortId(value) })),
    workspaces: [...workspaces].map((value) => ({ value, label: shortId(value) })),
    jobs: [...jobs].map((value) => ({ value, label: shortId(value) })),
  }
}

function ResourceUriCell({ event }: { event: AuditEvent }) {
  const uri = event.resource_uri
  const href = resourceUriHref(uri)
  const body = <span className="mono small">{uri}</span>
  return (
    <div data-testid="audit-resource" title={uri}>
      {href ? <Link to={href}>{body}</Link> : body}
    </div>
  )
}

function formatTs(ts: string): string {
  try {
    // Compact fixed layout — avoid wrapping; full ISO in title.
    const d = new Date(ts)
    if (Number.isNaN(d.getTime())) return ts
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
  } catch {
    return ts
  }
}

type AuditStatusKind = 'ok' | 'fail' | 'signed' | 'revoked' | 'orphan' | 'intent' | 'muted'

/** Leading status glyph for scanability (success / fail / signed / unpaired). */
function auditStatus(event: AuditEvent): { kind: AuditStatusKind; label: string } {
  if (event.orphan_aged) {
    return { kind: 'orphan', label: 'Aged unpaired Intent' }
  }
  if (event.phase === 'intent' || event.orphan) {
    return { kind: 'intent', label: 'Unpaired Intent (no Outcome yet)' }
  }
  if (event.action === 'esign.revoked' || event.action === 'esign.revocation_reverted') {
    return {
      kind: event.action === 'esign.revoked' ? 'revoked' : 'signed',
      label: event.action === 'esign.revoked' ? 'Signature revoked' : 'Revocation reverted',
    }
  }
  if (
    event.signature_id ||
    event.action.startsWith('esign.') ||
    event.action === 'signature.created'
  ) {
    return { kind: 'signed', label: 'Signed' }
  }
  if (event.status >= 400) {
    return { kind: 'fail', label: `Failed (HTTP ${event.status})` }
  }
  if (event.status >= 200 && event.status < 400) {
    return { kind: 'ok', label: 'Succeeded' }
  }
  return { kind: 'muted', label: 'Recorded' }
}

function AuditStatusCell({ event }: { event: AuditEvent }) {
  const { kind, label } = auditStatus(event)
  const iconProps = { size: 14 as const, 'aria-hidden': true as const, strokeWidth: 2.25 }
  const icon =
    kind === 'ok' ? (
      <Check {...iconProps} />
    ) : kind === 'fail' ? (
      <X {...iconProps} />
    ) : kind === 'signed' ? (
      <ActionShieldCheck {...iconProps} />
    ) : kind === 'revoked' ? (
      <ShieldOff {...iconProps} />
    ) : kind === 'orphan' ? (
      <AlertTriangle {...iconProps} />
    ) : kind === 'intent' ? (
      <Clock {...iconProps} />
    ) : (
      <Check {...iconProps} />
    )
  return (
    <td className="audit-col-status" title={label}>
      <span
        className={`audit-status-icon is-${kind}`}
        data-testid="audit-status"
        data-status={kind}
        aria-label={label}
      >
        {icon}
      </span>
    </td>
  )
}

/** Prefer first-class fields; fall back to detail for older Outcomes. */
function eventReason(event: AuditEvent): string | undefined {
  if (event.reason?.trim()) return event.reason
  const fromDetail = event.detail?.reason
  return typeof fromDetail === 'string' && fromDetail.trim() ? fromDetail : undefined
}

function eventChangeControlId(event: AuditEvent): string | undefined {
  if (event.change_control_id?.trim()) return event.change_control_id
  const fromDetail = event.detail?.changeControlId ?? event.detail?.change_control_id
  return typeof fromDetail === 'string' && fromDetail.trim() ? fromDetail : undefined
}

function ChangeControlCell({ event }: { event: AuditEvent }) {
  const id = eventChangeControlId(event)
  if (!id) return <span className="muted">—</span>
  return (
    <code className="mono small" data-testid="audit-change-control" title={id}>
      {id}
    </code>
  )
}

function formatChangeSide(side: Record<string, unknown> | null): string {
  if (side === null) return 'null'
  try {
    return JSON.stringify(side)
  } catch {
    return String(side)
  }
}

/** First-class `change.before → change.after`; empty for non-mutations. */
function changeSummary(event: AuditEvent): { text: string; title?: string; empty: boolean } {
  const change = event.change
  const empty =
    !change ||
    (change.before === null && change.after === null) ||
    (change.before !== null &&
      change.after !== null &&
      Object.keys(change.before).length === 0 &&
      Object.keys(change.after).length === 0)
  if (empty) {
    return { text: '—', title: 'No change recorded', empty: true }
  }
  const text = `${formatChangeSide(change.before)} → ${formatChangeSide(change.after)}`
  return { text, title: text, empty: false }
}

function formatChangePretty(side: Record<string, unknown> | null): string {
  if (side === null) return 'null'
  try {
    return JSON.stringify(side, null, 2)
  } catch {
    return String(side)
  }
}

function ChangeCell({ event }: { event: AuditEvent }) {
  const [open, setOpen] = useState(false)
  const change = changeSummary(event)
  if (change.empty) {
    return (
      <div className="small" data-testid="audit-change" title={change.title}>
        <span className="muted">{change.text}</span>
      </div>
    )
  }
  const before = event.change?.before ?? null
  const after = event.change?.after ?? null
  return (
    <div className="small audit-change-trigger" data-testid="audit-change" title={change.title}>
      <button
        type="button"
        className="audit-change-open mono"
        aria-label="Open change detail"
        onClick={() => setOpen(true)}
      >
        {change.text}
      </button>
      {open ? (
        <Modal title="Change" onClose={() => setOpen(false)} wide>
          <div className="audit-change-modal" data-testid="audit-change-modal">
            <p className="muted small">
              {actionLabel(event)}
              <span className="mono"> · {event.action}</span>
            </p>
            <div className="audit-change-sides">
              <section aria-labelledby="audit-change-before-h">
                <h3 id="audit-change-before-h" className="muted small">
                  Before
                </h3>
                <pre className="mono small audit-change-pre">{formatChangePretty(before)}</pre>
              </section>
              <section aria-labelledby="audit-change-after-h">
                <h3 id="audit-change-after-h" className="muted small">
                  After
                </h3>
                <pre className="mono small audit-change-pre">{formatChangePretty(after)}</pre>
              </section>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}

export function AuditPage() {
  const [params, setParams] = useSearchParams()
  const [draft, setDraft] = useState<Draft>(() => draftFromParams(params))
  const [exporting, setExporting] = useState<AuditExportFormat | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [verifyResult, setVerifyResult] = useState<AuditVerifyResult | null>(null)
  const [verifyError, setVerifyError] = useState<string | null>(null)

  const applied = useMemo(() => {
    const focusRaw = params.get('focus')
    const focus = INVESTIGATION_PRESETS.some((p) => p.id === focusRaw)
      ? (focusRaw as AuditFocus)
      : undefined
    return {
      since: params.get('since') || undefined,
      until: params.get('until') || undefined,
      actor: params.get('actor') || undefined,
      namespace: params.get('namespace') || undefined,
      repo: params.get('repo') || undefined,
      action: params.get('action') || undefined,
      focus,
      sessionId: params.get('session_id') || undefined,
      workspaceId: params.get('workspace_id') || undefined,
      jobId: params.get('job_id') || undefined,
      orphansOnly: params.get('orphans') === '1' || params.get('orphans') === 'true',
    }
  }, [params])

  const state = useAsync(
    (signal) => loadAudit({ ...applied, limit: 100 }, signal),
    [
      applied.since,
      applied.until,
      applied.actor,
      applied.namespace,
      applied.repo,
      applied.action,
      applied.focus,
      applied.sessionId,
      applied.workspaceId,
      applied.jobId,
      applied.orphansOnly,
    ],
  )
  const facetState = useAsync((signal) => fetchAuditFacets({}, signal), [])
  const facets: AuditFacets | null =
    facetState.kind === 'ok' ? facetState.data : null

  const actionOptions = useMemo<SuggestOption[]>(
    () =>
      (facets?.actions ?? []).map((a) => ({
        value: a.value,
        label: `${a.label} · ${a.group}`,
      })),
    [facets],
  )

  function set(key: FilterKey, value: string) {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  function onFilter(e: FormEvent) {
    e.preventDefault()
    const next = new URLSearchParams()
    for (const k of FILTER_KEYS) {
      if (k === 'since' || k === 'until') {
        const iso = localInputToIso(draft[k])
        if (iso) next.set(k, iso)
        continue
      }
      const v = draft[k].trim()
      if (v) next.set(k, v)
    }
    // Manual Action overrides Focus; otherwise keep the active Focus chip.
    if (!draft.action.trim() && applied.focus) next.set('focus', applied.focus)
    if (applied.orphansOnly) next.set('orphans', '1')
    setParams(next, { replace: true })
  }

  function clearFilters() {
    setDraft(draftFromParams(new URLSearchParams()))
    setParams({}, { replace: true })
  }

  function applyPreset(preset: (typeof INVESTIGATION_PRESETS)[number]) {
    const next = new URLSearchParams()
    next.set('focus', preset.id)
    if (applied.orphansOnly) next.set('orphans', '1')
    setDraft(draftFromParams(next))
    setParams(next, { replace: true })
  }

  function toggleOrphansOnly() {
    const next = new URLSearchParams(params)
    if (applied.orphansOnly) next.delete('orphans')
    else next.set('orphans', '1')
    setParams(next, { replace: true })
  }

  const activePresetId = applied.focus ?? null

  const denied = state.kind === 'ok' && state.data.kind === 'denied' ? state.data.reason : null
  const events = state.kind === 'ok' && state.data.kind === 'ok' ? state.data.data.events : null
  const orphanAgingSec =
    (state.kind === 'ok' && state.data.kind === 'ok' ? state.data.data.orphan_aging_sec : undefined) ??
    facets?.orphan_aging_sec ??
    15 * 60
  const eventSuggest = useMemo(() => suggestFromEvents(events ?? []), [events])
  const actorOptions = useMemo(
    () => mergeSuggestOptions(actorSuggestOptions(facets?.actors ?? []), eventSuggest.actors),
    [facets, eventSuggest],
  )
  const namespaceOptions = useMemo(
    () => mergeSuggestOptions(stringSuggestOptions(facets?.namespaces ?? []), eventSuggest.namespaces),
    [facets, eventSuggest],
  )
  const repoOptions = useMemo(
    () => mergeSuggestOptions(stringSuggestOptions(facets?.repos ?? []), eventSuggest.repos),
    [facets, eventSuggest],
  )
  const sessionOptions = useMemo(
    () => mergeSuggestOptions(resourceSuggestOptions(facets?.sessions ?? []), eventSuggest.sessions),
    [facets, eventSuggest],
  )
  const workspaceOptions = useMemo(
    () => mergeSuggestOptions(resourceSuggestOptions(facets?.workspaces ?? []), eventSuggest.workspaces),
    [facets, eventSuggest],
  )
  const jobOptions = useMemo(
    () => mergeSuggestOptions(resourceSuggestOptions(facets?.jobs ?? []), eventSuggest.jobs),
    [facets, eventSuggest],
  )
  const orphanIntents = useMemo(() => unpairedIntentEvents(events ?? []), [events])
  const agedOrphans = useMemo(() => agedOrphanIntentEvents(events ?? []), [events])
  const revoked = useMemo(() => revokedSignatureIds(events ?? []), [events])

  async function onExport(format: AuditExportFormat) {
    setExporting(format)
    setExportError(null)
    try {
      await exportAudit(format, applied)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setExporting(null)
    }
  }

  async function onVerify() {
    setVerifying(true)
    setVerifyError(null)
    setVerifyResult(null)
    try {
      setVerifyResult(await verifyAuditChain())
    } catch (err) {
      setVerifyError(
        err instanceof AuditDeniedError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Verification failed',
      )
    } finally {
      setVerifying(false)
    }
  }

  return (
    <main className="page wide">
      <div className="page-head">
        <div>
          <h1>Audit</h1>
          <p className="lede">
            Who changed what, when, and on which resource. Entries cannot be
            edited or deleted. Open a signature row to review sign-in and MFA
            evidence.
          </p>
        </div>
        <div className="btn-row audit-actions" role="group" aria-label="Audit actions">
          <button
            type="button"
            className="btn"
            onClick={() => void onExport('csv')}
            disabled={exporting !== null || denied !== null}
            aria-label="Export CSV"
            title="Download the events matching the applied filters"
          >
            <ActionDownload size={14} aria-hidden="true" className="button-label-icon" />
            {exporting === 'csv' ? '…' : 'CSV'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void onExport('pdf')}
            disabled={exporting !== null || denied !== null}
            aria-label="Export PDF"
            title="Download a PDF of the events matching the applied filters"
          >
            <ActionFileText size={14} aria-hidden="true" className="button-label-icon" />
            {exporting === 'pdf' ? '…' : 'PDF'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void onExport('bundle')}
            disabled={exporting !== null || denied !== null}
            aria-label="Export signed bundle"
            title="Download the signed evidence bundle (events, manifest, CSV, PDF, verification)"
          >
            <ActionShieldCheck size={14} aria-hidden="true" className="button-label-icon" />
            {exporting === 'bundle' ? '…' : 'Bundle'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void onVerify()}
            disabled={verifying || denied !== null}
            aria-label="Verify chain"
            title="Re-verify the audit chain and show the tip"
          >
            <ActionShieldCheck size={14} aria-hidden="true" className="button-label-icon" />
            {verifying ? '…' : 'Verify'}
          </button>
        </div>
      </div>
      {exportError && <p className="flash flash-error" role="alert">{exportError}</p>}
      {verifyError && <p className="flash flash-error" role="alert" data-testid="audit-verify-error">{verifyError}</p>}
      {verifyResult?.ok === true && (
        <p className="flash flash-success" role="status" data-testid="audit-verify-ok">
          Chain verified ({verifyResult.events} events) at {formatTs(verifyResult.verifiedAt)}. Tip txid{' '}
          <code className="inline-code" data-testid="audit-verify-txid">{verifyResult.tip.txid}</code>
          {' · '}root{' '}
          <code className="inline-code" data-testid="audit-verify-root">{verifyResult.tip.root || '(empty ledger)'}</code>
        </p>
      )}
      {verifyResult?.ok === false && (
        <p className="flash flash-error" role="alert" data-testid="audit-verify-break">
          Chain verification failed at event {verifyResult.firstBreak.seq}: {verifyResult.firstBreak.reason}
        </p>
      )}
      {orphanIntents.length > 0 && (
        <p className="flash flash-warn" role="status" aria-atomic="true" data-testid="audit-orphan-summary">
          {agedOrphans.length > 0
            ? `${agedOrphans.length} aged Intent${agedOrphans.length === 1 ? '' : 's'} without Outcome (older than ${Math.round(orphanAgingSec / 60)} min) — listed first for investigation.`
            : orphanIntents.length === 1
              ? '1 Intent without Outcome is visible — investigate before assuming the mutation finished.'
              : `${orphanIntents.length} Intents without Outcome are visible — investigate before assuming those mutations finished.`}
          {' '}
          <button
            type="button"
            className="btn ghost small"
            data-testid="audit-orphans-filter"
            onClick={toggleOrphansOnly}
          >
            {applied.orphansOnly ? 'Show all events' : 'Show unpaired only'}
          </button>
        </p>
      )}

      <form className="audit-filters" onSubmit={onFilter}>
        <div
          className="audit-presets"
          role="group"
          aria-label="Investigation focus"
          data-testid="audit-investigation-presets"
        >
          {INVESTIGATION_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`btn small ${activePresetId === preset.id ? 'primary' : 'ghost'}`}
              title={preset.title}
              data-testid={`audit-preset-${preset.id}`}
              aria-pressed={activePresetId === preset.id}
              onClick={() => applyPreset(preset)}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <label className="audit-filter-datetime">
          <span>From</span>
          <input
            type="datetime-local"
            name="since"
            value={draft.since}
            onChange={(e) => set('since', e.target.value)}
            data-testid="audit-filter-from"
            aria-label="From date and time"
          />
        </label>
        <label className="audit-filter-datetime">
          <span>To</span>
          <input
            type="datetime-local"
            name="until"
            value={draft.until}
            onChange={(e) => set('until', e.target.value)}
            data-testid="audit-filter-to"
            aria-label="To date and time"
          />
        </label>
        <SuggestField
          name="actor"
          label="Actor"
          value={draft.actor}
          onChange={(v) => set('actor', v)}
          options={actorOptions}
          placeholder="email, name, or sub"
          emptyHint="All actors"
        />
        <SuggestField
          name="namespace"
          label="Namespace"
          value={draft.namespace}
          onChange={(v) => set('namespace', v)}
          options={namespaceOptions}
          placeholder="namespace"
          emptyHint="All namespaces"
        />
        <SuggestField
          name="repo"
          label="Repo"
          value={draft.repo}
          onChange={(v) => set('repo', v)}
          options={repoOptions}
          placeholder="repo"
          emptyHint="All repos"
        />
        <SuggestField
          name="action"
          label="Action"
          value={draft.action}
          onChange={(v) => set('action', v)}
          options={actionOptions}
          placeholder="All actions"
          emptyHint="All actions"
        />
        <SuggestField
          name="session_id"
          label="Session"
          value={draft.session_id}
          onChange={(v) => set('session_id', v)}
          options={sessionOptions}
          emptyHint="All sessions"
        />
        <SuggestField
          name="workspace_id"
          label="Stage"
          value={draft.workspace_id}
          onChange={(v) => set('workspace_id', v)}
          options={workspaceOptions}
          emptyHint="All stages"
        />
        <SuggestField
          name="job_id"
          label="Job"
          value={draft.job_id}
          onChange={(v) => set('job_id', v)}
          options={jobOptions}
          emptyHint="All jobs"
        />
        <div className="audit-filter-actions">
          <button type="submit" className="btn primary">
            <ActionSearch size={14} aria-hidden="true" className="button-label-icon" />Filter
          </button>
          <button type="button" className="btn ghost" onClick={clearFilters}>
            <ActionTrash2 size={14} aria-hidden="true" className="button-label-icon" />Clear
          </button>
        </div>
      </form>

      <StateBlock
        loading={state.kind === 'loading'}
        error={state.kind === 'error' ? state.message : null}
        onRetry={() => state.reload()}
        empty={denied !== null || (events !== null && events.length === 0)}
        emptyMessage={
          denied !== null ? (
            <div role="alert" data-testid="audit-denied">
              <p className="muted">
                <strong>Access denied.</strong> {denied}
              </p>
              <p className="muted small">
                Viewing the audit log needs the instance <code className="inline-code">audit:read</code>{' '}
                permission, or ownership of / <code className="inline-code">view_audit</code> on a namespace.
                Ask an instance admin to grant access.
              </p>
            </div>
          ) : (
            'No audit events match these filters.'
          )
        }
      >
        {events !== null && (
          <div className="branches-table-wrap">
            <table className="branches-table audit-table">
              <thead>
                <tr>
                  <th className="audit-col-status" scope="col">
                    <span className="visually-hidden">Status</span>
                  </th>
                  <th>When</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Resource</th>
                  <th>Reason</th>
                  <th>Change control</th>
                  <th>Change</th>
                  <th className="audit-col-actions">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => (
                  <tr
                    key={ev.id}
                    data-audit-id={ev.id}
                    data-audit-phase={ev.phase ?? ''}
                    data-orphan-aged={ev.orphan_aged ? 'true' : undefined}
                    className={
                      ev.orphan_aged
                        ? 'audit-row-orphan audit-row-orphan-aged'
                        : ev.phase === 'intent' || ev.orphan
                          ? 'audit-row-orphan'
                          : undefined
                    }
                    data-testid={ev.phase === 'intent' || ev.orphan ? 'audit-orphan-intent' : undefined}
                  >
                    <AuditStatusCell event={ev} />
                    <td className="mono small audit-when" title={ev.ts}>
                      {formatTs(ev.ts)}
                    </td>
                    <td>
                      <div>{ev.actor.name}</div>
                      <div className="muted small">{ev.actor.email}</div>
                    </td>
                    <td title={ev.action}>
                      <div>{actionLabel(ev)}</div>
                      <div className="muted small mono">{ev.action}</div>
                      {ev.phase === 'intent' || ev.orphan ? (
                        <span
                          className={`ns-tag ${ev.orphan_aged ? 'ns-tag-warn' : 'ns-tag-muted'}`}
                          title={
                            ev.orphan_aged
                              ? `Unpaired Intent older than ${Math.round(orphanAgingSec / 60)} minutes`
                              : 'This Intent has no Outcome yet'
                          }
                          data-testid="audit-orphan-badge"
                        >
                          {ev.orphan_aged ? 'Aged orphan' : 'No Outcome'}
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <ResourceUriCell event={ev} />
                    </td>
                    <td className="small audit-reason">
                      {(() => {
                        const reason = eventReason(ev)
                        if (!reason) return <span className="muted">—</span>
                        return (
                          <>
                            {ev.category ? (
                              <div className="muted small">{ev.category.replace(/_/g, ' ')}</div>
                            ) : null}
                            <div className="audit-reason-text" title={reason}>
                              {reason}
                            </div>
                          </>
                        )
                      })()}
                    </td>
                    <td>
                      <ChangeControlCell event={ev} />
                    </td>
                    <td className="audit-change-cell">
                      <ChangeCell event={ev} />
                    </td>
                    <td className="audit-col-actions">
                      <div className="audit-signature-actions btn-row">
                        <SignatureEvidence event={ev} />
                        <SignatureRevokedTag event={ev} revoked={revoked} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </StateBlock>
    </main>
  )
}

/**
 * Auditor observation only: show Revoked when a linked revocation exists.
 * Approvers revoke from repo Settings → Signatures (#93); roles stay separate.
 */
function SignatureRevokedTag({
  event,
  revoked,
}: {
  event: AuditEvent
  revoked: Set<string>
}) {
  const signatureId = revocableSignatureId(event.action, event.detail, event.signature_id)
  if (!signatureId || !revoked.has(signatureId)) return null
  return (
    <p className="small" data-testid="signature-revoked-tag">
      <span className="ns-tag ns-tag-warn">Revoked</span>
    </p>
  )
}

function evidenceTestId(label: string): string | undefined {
  if (label === 'Now known as') return 'signature-now-known-as'
  if (label === 'Auth context (acr)') return 'signature-evidence-acr'
  if (label === 'Auth methods (amr)') return 'signature-evidence-amr'
  if (label === 'Authenticated at') return 'signature-evidence-auth-time'
  if (label === 'JWKS key id') return 'signature-evidence-jwks-kid'
  if (label === 'Verified at') return 'signature-evidence-verified-at'
  if (label === 'Issuer') return 'signature-evidence-issuer'
  return undefined
}

function SignatureEvidence({ event }: { event: AuditEvent }) {
  const [open, setOpen] = useState(false)
  // Top-level signature_id counts even when producers only set that field.
  const detail =
    event.detail || event.signature_id
      ? {
          ...(event.detail ?? {}),
          ...(event.signature_id && !(event.detail && 'signatureId' in event.detail)
            ? { signatureId: event.signature_id }
            : {}),
        }
      : undefined
  const sections = signatureEvidenceSections(event.action, detail)
  if (sections.length === 0) return null
  return (
    <div className="signature-evidence-cell small" data-testid="signature-evidence">
      <button
        type="button"
        className="btn ghost small signature-evidence-open"
        aria-label="Signature"
        onClick={() => setOpen(true)}
      >
        <ActionFileSignature size={12} aria-hidden="true" className="button-label-icon" />
        Signature
      </button>
      {open ? (
        <Modal title="Signature evidence" onClose={() => setOpen(false)} wide>
          <div className="signature-evidence">
            <p className="muted small signature-evidence-lede">
              IdP MFA assertion and verification metadata recorded at signing. Auditors
              use this to prove who signed and that Mice verified the token.
            </p>
            {sections.map((section) => (
              <section
                key={section.id}
                className="signature-evidence-section"
                data-testid={`signature-evidence-${section.id}`}
                aria-labelledby={`signature-evidence-h-${section.id}`}
              >
                <h3
                  id={`signature-evidence-h-${section.id}`}
                  className="signature-evidence-heading muted"
                >
                  {section.heading}
                </h3>
                <dl aria-label={section.heading}>
                  {section.rows.map((r) => (
                    <div key={r.label} data-evidence-label={r.label}>
                      <dt className="muted">{r.label}</dt>
                      <dd className="mono" data-testid={evidenceTestId(r.label)}>
                        {r.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
