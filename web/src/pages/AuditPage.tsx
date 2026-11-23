import {
  Download as ActionDownload,
  FileSearch as ActionFileSearch,
  FileText as ActionFileText,
  Search as ActionSearch,
  ShieldCheck as ActionShieldCheck,
  Trash2 as ActionTrash2,
} from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Modal } from '../components/Modal'
import { RevokeSignatureButton } from '../components/RevokeSignatureButton'
import { StateBlock } from '../components/StateBlock'
import { SuggestField, type SuggestOption } from '../components/SuggestField'
import { useAsync } from '../hooks/useAsync'
import {
  actionLabel,
  eventResources,
  AuditDeniedError,
  exportAudit,
  fetchAuditFacets,
  loadAudit,
  unpairedIntentEvents,
  verifyAuditChain,
  type AuditEvent,
  type AuditExportFormat,
  type AuditFacets,
  type AuditResource,
  type AuditVerifyResult,
} from '../lib/audit'
import { signatureEvidenceSections } from '../lib/signatureEvidence'
import { revocableSignatureId, revokedSignatureIds } from '../lib/signatureRevoke'

const FILTER_KEYS = [
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

function draftFromParams(p: URLSearchParams): Draft {
  return Object.fromEntries(FILTER_KEYS.map((k) => [k, p.get(k) ?? ''])) as Draft
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

function ResourceCell({ event }: { event: AuditEvent }) {
  const r = eventResources(event)
  const items: [string, string][] = []
  if (r.sessionId) items.push(['Session', r.sessionId])
  if (r.workspaceId) items.push(['Workspace', r.workspaceId])
  for (const j of r.jobIds.slice(0, 3)) items.push(['Job', j])
  if (r.jobIds.length > 3) items.push(['Jobs', `+${r.jobIds.length - 3} more`])
  if (items.length === 0) return <span className="muted">—</span>
  return (
    <div className="small">
      {items.map(([k, v]) => (
        <div key={`${k}:${v}`} title={v}>
          <span className="muted">{k}</span> <span className="mono">{shortId(v)}</span>
        </div>
      ))}
    </div>
  )
}

function formatTs(ts: string): string {
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return ts
  }
}

function ChangeControlCell({ event }: { event: AuditEvent }) {
  if (!event.change_control_id) return <span className="muted">—</span>
  return (
    <code className="mono small" data-testid="audit-change-control" title={event.change_control_id}>
      {event.change_control_id}
    </code>
  )
}

function DatasetCell({ event }: { event: AuditEvent }) {
  const { base, head } = event.dataset ?? {}
  if (!base && !head) return <span className="muted">—</span>
  return (
    <div className="small" data-testid="audit-dataset">
      {base ? (
        <div title={base}>
          <span className="muted">Base</span> <span className="mono">{shortId(base)}</span>
        </div>
      ) : null}
      {head ? (
        <div title={head}>
          <span className="muted">Head</span> <span className="mono">{shortId(head)}</span>
        </div>
      ) : null}
    </div>
  )
}

function RepoCell({ event }: { event: AuditEvent }) {
  if (!event.namespace || !event.repo) {
    return <span className="muted">—</span>
  }
  return (
    <Link to={`/n/${encodeURIComponent(event.namespace)}/r/${encodeURIComponent(event.repo)}`}>
      {event.namespace}/{event.repo}
    </Link>
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

  const applied = useMemo(
    () => ({
      actor: params.get('actor') || undefined,
      namespace: params.get('namespace') || undefined,
      repo: params.get('repo') || undefined,
      action: params.get('action') || undefined,
      sessionId: params.get('session_id') || undefined,
      workspaceId: params.get('workspace_id') || undefined,
      jobId: params.get('job_id') || undefined,
    }),
    [params],
  )

  const state = useAsync(
    (signal) => loadAudit({ ...applied, limit: 100 }, signal),
    [
      applied.actor,
      applied.namespace,
      applied.repo,
      applied.action,
      applied.sessionId,
      applied.workspaceId,
      applied.jobId,
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
      const v = draft[k].trim()
      if (v) next.set(k, v)
    }
    setParams(next, { replace: true })
  }

  function clearFilters() {
    setDraft(draftFromParams(new URLSearchParams()))
    setParams({}, { replace: true })
  }

  const denied = state.kind === 'ok' && state.data.kind === 'denied' ? state.data.reason : null
  const events = state.kind === 'ok' && state.data.kind === 'ok' ? state.data.data.events : null
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
            Append-only log of mutations through the auth BFF (who / what / when
            / which repo). Signature rows open IdP MFA evidence for auditors.
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
          {orphanIntents.length === 1
            ? '1 Intent without Outcome is visible in this page — investigate before assuming the mutation finished.'
            : `${orphanIntents.length} Intents without Outcome are visible in this page — investigate before assuming those mutations finished.`}
        </p>
      )}

      <form className="audit-filters" onSubmit={onFilter}>
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
                  <th>When</th>
                  <th>Actor</th>
                  <th>Via</th>
                  <th>Action</th>
                  <th>Repo</th>
                  <th>Resource</th>
                  <th>Status</th>
                  <th>Reason</th>
                  <th>Change control</th>
                  <th>Dataset</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => (
                  <tr
                    key={ev.id}
                    data-audit-id={ev.id}
                    data-audit-phase={ev.phase ?? ''}
                    data-testid={ev.phase === 'intent' ? 'audit-orphan-intent' : undefined}
                  >
                    <td className="mono small">{formatTs(ev.ts)}</td>
                    <td>
                      <div>{ev.actor.name}</div>
                      <div className="muted small">{ev.actor.email}</div>
                    </td>
                    <td className="mono small">{ev.via}</td>
                    <td title={ev.action}>
                      <div>{actionLabel(ev)}</div>
                      <div className="muted small mono">{ev.action}</div>
                      {ev.phase === 'intent' ? (
                        <span
                          className="ns-tag ns-tag-warn"
                          title="This Intent has no Outcome yet"
                          data-testid="audit-orphan-badge"
                        >
                          No Outcome
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <RepoCell event={ev} />
                    </td>
                    <td>
                      <ResourceCell event={ev} />
                    </td>
                    <td className="mono small">{ev.status}</td>
                    <td className="small">
                      {ev.reason ? (
                        <>
                          {ev.category ? (
                            <div className="muted small">{ev.category.replace(/_/g, ' ')}</div>
                          ) : null}
                          <div>{ev.reason}</div>
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <ChangeControlCell event={ev} />
                    </td>
                    <td>
                      <DatasetCell event={ev} />
                    </td>
                    <td className="small">
                      {ev.message || (
                        <span className="muted">
                          {typeof ev.detail?.path === 'string'
                            ? ev.detail.path
                            : '—'}
                        </span>
                      )}
                      <div className="audit-signature-actions btn-row">
                        <SignatureEvidence event={ev} />
                        <SignatureRevoke
                          event={ev}
                          revoked={revoked}
                          onRevoked={() => state.reload()}
                        />
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

/** Revoke control (or a "Revoked" tag) on signature rows (GxP #93). */
function SignatureRevoke({
  event,
  revoked,
  onRevoked,
}: {
  event: AuditEvent
  revoked: Set<string>
  onRevoked: () => void
}) {
  const signatureId = revocableSignatureId(event.action, event.detail, event.signature_id)
  if (!signatureId) return null
  if (revoked.has(signatureId)) {
    return (
      <p className="small" data-testid="signature-revoked-tag">
        <span className="ns-tag ns-tag-warn">Revoked</span>
      </p>
    )
  }
  return (
    <div className="small" data-testid="signature-revoke">
      <RevokeSignatureButton signatureId={signatureId} onRevoked={onRevoked} />
    </div>
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
  const sections = signatureEvidenceSections(event.action, event.detail)
  if (sections.length === 0) return null
  return (
    <div className="signature-evidence-cell small" data-testid="signature-evidence">
      <button
        type="button"
        className="btn ghost small signature-evidence-open"
        aria-label="Signature evidence"
        onClick={() => setOpen(true)}
      >
        <ActionFileSearch size={12} aria-hidden="true" className="button-label-icon" />
        Evidence
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
