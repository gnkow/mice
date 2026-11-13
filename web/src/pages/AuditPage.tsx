import { Download as ActionDownload, Search as ActionSearch, Trash2 as ActionTrash2 } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { StateBlock } from '../components/StateBlock'
import { useAsync } from '../hooks/useAsync'
import {
  actionLabel,
  eventResources,
  exportAuditCsv,
  fetchAudit,
  fetchAuditFacets,
  type AuditEvent,
  type AuditFacets,
  type AuditResource,
} from '../lib/audit'
import { signatureEvidenceRows } from '../lib/signatureEvidence'

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

function resourceLabel(r: AuditResource): string {
  const where = r.repo ? ` · ${r.namespace ?? ''}/${r.repo}` : r.namespace ? ` · ${r.namespace}` : ''
  return `${shortId(r.id)}${where} (${r.count})`
}

function ResourceSelect({
  name,
  label,
  value,
  options,
  onChange,
}: {
  name: string
  label: string
  value: string
  options: AuditResource[]
  onChange: (v: string) => void
}) {
  const known = options.some((o) => o.id === value)
  return (
    <label>
      {label}
      <select name={name} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All</option>
        {value && !known && <option value={value}>{shortId(value)}</option>}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {resourceLabel(o)}
          </option>
        ))}
      </select>
    </label>
  )
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
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

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
    (signal) => fetchAudit({ ...applied, limit: 100 }, signal),
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

  const actionGroups = useMemo(() => {
    const groups = new Map<string, { value: string; label: string }[]>()
    for (const a of facets?.actions ?? []) {
      const list = groups.get(a.group) ?? []
      list.push(a)
      groups.set(a.group, list)
    }
    return [...groups.entries()]
  }, [facets])

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

  async function onExport() {
    setExporting(true)
    setExportError(null)
    try {
      await exportAuditCsv(applied)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  return (
    <main className="page wide">
      <div className="page-head">
        <div>
          <h1>Audit</h1>
          <p className="lede">
            Append-only log of mutations through the auth BFF (who / what / when
            / which repo). Signature rows expand to show IdP MFA evidence for auditors.
          </p>
        </div>
        <button
          type="button"
          className="btn"
          onClick={() => void onExport()}
          disabled={exporting}
          title="Download the events matching the applied filters"
        >
          <ActionDownload size={14} aria-hidden="true" className="button-label-icon" />{exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      </div>
      {exportError && <p className="flash flash-error">{exportError}</p>}

      <form className="audit-filters" onSubmit={onFilter}>
        <label>
          Actor
          <input
            name="actor"
            value={draft.actor}
            onChange={(e) => set('actor', e.target.value)}
            placeholder="email, name, or sub"
          />
        </label>
        <label>
          Namespace
          <input
            name="namespace"
            value={draft.namespace}
            onChange={(e) => set('namespace', e.target.value)}
            placeholder="namespace"
          />
        </label>
        <label>
          Repo
          <input
            name="repo"
            value={draft.repo}
            onChange={(e) => set('repo', e.target.value)}
            placeholder="repo"
          />
        </label>
        <label>
          Action
          <select
            name="action"
            value={draft.action}
            onChange={(e) => set('action', e.target.value)}
          >
            <option value="">All actions</option>
            {draft.action &&
              !(facets?.actions ?? []).some((a) => a.value === draft.action) && (
                <option value={draft.action}>{draft.action}</option>
              )}
            {actionGroups.map(([group, items]) => (
              <optgroup key={group} label={group}>
                {items.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <ResourceSelect
          name="session_id"
          label="Session"
          value={draft.session_id}
          options={facets?.sessions ?? []}
          onChange={(v) => set('session_id', v)}
        />
        <ResourceSelect
          name="workspace_id"
          label="Stage"
          value={draft.workspace_id}
          options={facets?.workspaces ?? []}
          onChange={(v) => set('workspace_id', v)}
        />
        <ResourceSelect
          name="job_id"
          label="Job"
          value={draft.job_id}
          options={facets?.jobs ?? []}
          onChange={(v) => set('job_id', v)}
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
        empty={state.kind === 'ok' && state.data.events.length === 0}
        emptyMessage="No audit events match these filters."
      >
        {state.kind === 'ok' && (
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
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {state.data.events.map((ev) => (
                  <tr key={ev.id} data-audit-id={ev.id}>
                    <td className="mono small">{formatTs(ev.ts)}</td>
                    <td>
                      <div>{ev.actor.name}</div>
                      <div className="muted small">{ev.actor.email}</div>
                    </td>
                    <td className="mono small">{ev.via}</td>
                    <td title={ev.action}>
                      <div>{actionLabel(ev)}</div>
                      <div className="muted small mono">{ev.action}</div>
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
                    <td className="small">
                      {ev.message || (
                        <span className="muted">
                          {typeof ev.detail?.path === 'string'
                            ? ev.detail.path
                            : '—'}
                        </span>
                      )}
                      <SignatureEvidence event={ev} />
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
  const rows = signatureEvidenceRows(event.action, event.detail)
  if (rows.length === 0) return null
  return (
    <details className="signature-evidence small" data-testid="signature-evidence">
      <summary>Signature evidence</summary>
      <p className="muted small signature-evidence-lede">
        IdP MFA assertion and verification metadata recorded at signing. Auditors use
        this to prove who signed and that Mice verified the token.
      </p>
      <dl aria-label="Signature identity and evidence">
        {rows.map((r) => (
          <div key={r.label} data-evidence-label={r.label}>
            <dt className="muted">{r.label}</dt>
            <dd className="mono" data-testid={evidenceTestId(r.label)}>
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  )
}
