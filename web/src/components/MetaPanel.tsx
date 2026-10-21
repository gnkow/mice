import { RefreshCw as ActionRefreshCw, Save as ActionSave, Tags as ActionTags, Trash2 as ActionTrash2, X as ActionX } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Pencil, Trash2 } from 'lucide-react'
import { useAsync } from '../hooks/useAsync'
import { deleteMeta, entityMetaUrl, fetchMeta, saveMeta, MetaApiError, metaKey, type MetaPatch, type MetaTarget } from '../lib/meta'
import { StateBlock } from './StateBlock'
import { confirmDelete } from '../lib/confirmDelete'

type ScopeChange = (scope: MetaTarget['scope'], ready: boolean) => void
type LabelDraft = { name: string; key: string; value: string }

export function MetaPanel({ defaultOpen = false, compact = false, ...rest }: MetaTarget & {
  focus?: string
  defaultOpen?: boolean
  compact?: boolean
  onScopeChange?: ScopeChange
}) {
  const [expanded, setExpanded] = useState(defaultOpen)
  return (
    <details className={`meta-panel${compact ? ' meta-compact' : ''}`} aria-label="Metadata" data-testid="meta-panel" open={expanded} onToggle={e => setExpanded(e.currentTarget.open)}>
      <summary className="meta-summary">
        <span>Metadata</span>
        {compact && expanded && <Link className="small" to={entityMetaUrl(rest)} onClick={e => e.stopPropagation()}>Open</Link>}
      </summary>
      {expanded && <MetaBody {...rest} />}
    </details>
  )
}

export function MetaBody({ scope, context, onScopeChange, ...target }: MetaTarget & {
  focus?: string
  context?: NonNullable<MetaTarget['scope']>
  onScopeChange?: ScopeChange
}) {
  const isPath = target.type === 'file' || target.type === 'directory'
  const [choice, setChoice] = useState(scope?.kind ?? 'repository')
  const [revision, setRevision] = useState(scope?.id ?? context?.id ?? '')
  const selected = choice === 'branch' || choice === 'commit' ? { kind: choice, id: revision.trim() } as const : undefined
  const ready = !isPath || choice === 'repository' || !!revision.trim()
  const ref = { ...target, scope: isPath ? selected : scope }
  return (
    <>
      {isPath && <div className="meta-scope-picker">
        <label>Metadata scope
          <select aria-label="Metadata scope" value={choice} onChange={e => {
            const value = e.target.value
            if (value !== 'repository' && value !== 'branch' && value !== 'commit') return
            setChoice(value)
            const next = scope?.kind === value ? scope.id : context?.kind === value ? context.id : ''
            setRevision(next)
            onScopeChange?.(value !== 'repository' && next ? { kind: value, id: next } : undefined, value === 'repository' || !!next)
          }}>
            <option value="repository">General (this path only)</option>
            <option value="branch">Specific branch</option>
            <option value="commit">Specific commit</option>
          </select>
        </label>
        {(choice === 'branch' || choice === 'commit') && <label>
          {choice === 'branch' ? 'Branch name' : 'Commit ID'}
          <input aria-label="Scope revision" value={revision} onChange={e => {
            setRevision(e.target.value)
            const id = e.target.value.trim()
            onScopeChange?.(id ? { kind: choice, id } : undefined, !!id)
          }} />
        </label>}
      </div>}
      {ready ? <MetaEditor key={metaKey(ref)} {...ref} /> : <p className="muted small">Enter a branch name or commit ID to view and edit metadata.</p>}
    </>
  )
}

function MetaEditor({ type, id, scope, focus }: MetaTarget & { focus?: string }) {
  const state = useAsync(signal => fetchMeta(type, id, signal, scope), [type, id, scope?.kind, scope?.id])
  const [busy, setBusy] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [tag, setTag] = useState('')
  const [key, setKey] = useState('')
  const [value, setValue] = useState('')
  const [editingTag, setEditingTag] = useState<{ name: string; value: string } | null>(null)
  const [editing, setEditing] = useState<LabelDraft | null>(null)
  const view = state.kind === 'ok' ? state.data : null
  const own = view?.own
  const disabled = busy || conflict || !view?.canEdit

  async function run(patch: MetaPatch | 'delete', after?: () => void) {
    if (disabled || !view) return
    setBusy(true)
    setErr(null)
    setNotice(null)
    try {
      const ref = { type, id, scope }
      if (patch === 'delete') await deleteMeta(ref, view.revision, view.version)
      else await saveMeta(ref, patch, view.revision, view.version)
      after?.()
      setNotice('Saved')
      state.reload()
    } catch (e) {
      if (e instanceof MetaApiError && e.status === 409) setConflict(true)
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function saveTag(e: FormEvent) {
    e.preventDefault()
    if (!editingTag) return
    const next = editingTag.value.trim().toLowerCase()
    if (!next) return
    if (next !== editingTag.name && own?.tags.includes(next) && !await confirmDelete({
      title: `Merge tag into "${next}"?`, detail: 'The destination tag already exists. This will merge the tags and remove the old name.', requireTypedConfirm: false,
    })) return
    void run({ tags: [...new Set([...(own?.tags ?? []).filter(t => t !== editingTag.name), next])] }, () => setEditingTag(null))
  }

  async function saveLabel(e: FormEvent) {
    e.preventDefault()
    if (!editing) return
    const next = editing.key.trim().toLowerCase()
    if (!next) return
    if (next !== editing.name && Object.hasOwn(own?.labels ?? {}, next) && !await confirmDelete({
      title: `Replace label "${next}"?`, detail: 'The destination label will be replaced and the old key removed.', requireTypedConfirm: false,
    })) return
    void run({ labels: { ...(next !== editing.name ? { [editing.name]: null } : {}), [next]: editing.value } }, () => setEditing(null))
  }

  return <div className="meta-body">
    <p className="meta-intro">Tags and labels apply only to this resource and selected scope. Nothing is inherited.</p>
    {err && <p className="error small" role="alert">{err}</p>}
    {conflict && <div className="meta-conflict" role="alert">
      <p>Metadata changed since you loaded it. Your draft is preserved. Load the latest metadata, review it, then save again.</p>
      <button type="button" className="btn small" onClick={() => { state.reload(); setConflict(false); setErr(null) }}><ActionRefreshCw size={14} aria-hidden="true" className="button-label-icon" />Load latest metadata</button>
    </div>}
    {notice && <p className="muted small" role="status" data-testid="meta-notice">{notice}</p>}
    <StateBlock loading={state.kind === 'loading'} error={state.kind === 'error' ? state.message : null} onRetry={state.reload}>
      {view && <fieldset className="meta-editable" disabled={disabled} data-testid="meta-view">
        <div className="meta-block">
          <header className="meta-section-head"><h4>Tags</h4></header>
          <ul className="meta-chips" data-testid="meta-tags">
            {(own?.tags ?? []).map(t => <li key={t} className="meta-chip" data-focus={focus === `tag:${t}` || undefined}>
              <span className="meta-chip-name">{t}</span>
              {view.canEdit && <>
                <button type="button" className="meta-action-btn" aria-label={`Edit tag ${t}`} title="Edit tag" onClick={() => setEditingTag({ name: t, value: t })}><Pencil size={13} aria-hidden /></button>
                <button type="button" className="meta-action-btn" aria-label={`Remove tag ${t}`} title="Remove tag" onClick={() => run({ tags: (own?.tags ?? []).filter(x => x !== t) })}><Trash2 size={13} aria-hidden /></button>
              </>}
            </li>)}
            {!own?.tags.length && <li className="meta-empty muted small">No tags.</li>}
          </ul>
          {view.canEdit && <form className="meta-inline" onSubmit={e => {
            e.preventDefault()
            if (tag.trim()) void run({ tags: [...new Set([...(own?.tags ?? []), tag.trim().toLowerCase()])] }, () => setTag(''))
          }}>
            <label>Tag<input aria-label="Add tag" value={tag} onChange={e => setTag(e.target.value)} /></label>
            <button className="btn small" disabled={!tag.trim()}><ActionTags size={14} aria-hidden="true" className="button-label-icon" />Add tag</button>
          </form>}
        </div>
        <div className="meta-block">
          <header className="meta-section-head"><h4>Labels</h4></header>
          {Object.keys(own?.labels ?? {}).length ? <table className="meta-table" data-testid="meta-labels">
            <thead><tr><th>Key</th><th>Value</th><th aria-label="Actions" /></tr></thead>
            <tbody>{Object.entries(own?.labels ?? {}).map(([name, val]) => <tr key={name}>
              <td><code>{name}</code></td><td className="meta-label-text">{val || <span className="muted">Empty value</span>}</td>
              <td className="meta-actions">{view.canEdit && <div className="meta-label-actions">
                <button type="button" className="meta-action-btn" aria-label="Edit" title={`Edit label ${name}`} onClick={() => setEditing({ name, key: name, value: val })}><Pencil size={13} aria-hidden /></button>
                <button type="button" className="meta-action-btn" aria-label={`Remove label ${name}`} title="Remove label" onClick={() => run({ labels: { [name]: null } })}><Trash2 size={13} aria-hidden /></button>
              </div>}</td>
            </tr>)}</tbody>
          </table> : <p className="meta-empty muted small">No labels.</p>}
          {view.canEdit && <form className="meta-inline" onSubmit={e => {
            e.preventDefault()
            if (key.trim()) void run({ labels: { [key.trim().toLowerCase()]: value } }, () => { setKey(''); setValue('') })
          }}>
            <label>Key<input aria-label="Key" value={key} onChange={e => setKey(e.target.value)} /></label>
            <label>Value<input aria-label="Value" value={value} onChange={e => setValue(e.target.value)} /></label>
            <button className="btn small" disabled={!key.trim()}><ActionTags size={14} aria-hidden="true" className="button-label-icon" />Add label</button>
          </form>}
        </div>
        {view.canEdit && <button type="button" className="btn ghost small" disabled={!own} onClick={async () => {
          if (await confirmDelete({ title: 'Clear all metadata?', detail: 'Remove all tags and labels on this resource and scope.', requireTypedConfirm: false })) void run('delete')
        }}><ActionTrash2 size={14} aria-hidden="true" className="button-label-icon" />Clear all metadata</button>}
      </fieldset>}
    </StateBlock>
    {editingTag && <form className="meta-inline" onSubmit={saveTag}>
      <label>Tag name<input aria-label={`Name for tag ${editingTag.name}`} value={editingTag.value} onChange={e => setEditingTag({ ...editingTag, value: e.target.value })} disabled={disabled} /></label>
      <button className="btn small" disabled={disabled || !editingTag.value.trim()}><ActionSave size={14} aria-hidden="true" className="button-label-icon" />Save tag</button>
      <button type="button" className="btn ghost small" disabled={busy} onClick={() => setEditingTag(null)}><ActionX size={14} aria-hidden="true" className="button-label-icon" />Cancel</button>
    </form>}
    {editing && <form className="meta-label-editor" onSubmit={saveLabel}>
      <label>Key<input aria-label={`Key for ${editing.name}`} value={editing.key} onChange={e => setEditing({ ...editing, key: e.target.value })} disabled={disabled} /></label>
      <label>Value<textarea aria-label={`Value for ${editing.name}`} value={editing.value} onChange={e => setEditing({ ...editing, value: e.target.value })} disabled={disabled} rows={2} /></label>
      <div className="btn-row">
        <button className="btn small" disabled={disabled || !editing.key.trim()}><ActionSave size={14} aria-hidden="true" className="button-label-icon" />Save</button>
        <button type="button" className="btn ghost small" disabled={busy} onClick={() => setEditing(null)}><ActionX size={14} aria-hidden="true" className="button-label-icon" />Cancel</button>
      </div>
    </form>}
  </div>
}
