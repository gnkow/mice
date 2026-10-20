import { useMemo, useState, type FormEvent } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Breadcrumbs, repoCrumbs } from '../components/Breadcrumbs'
import { useAsync } from '../hooks/useAsync'
import {
  createDataFrameCompare,
  deleteDataFrameCompare,
  getDataFrameCompareDiff,
  listBranches,
  updateDataFrameCompare,
} from '../lib/oxen/api'
import { confirmDelete } from '../lib/confirmDelete'
import {
  OxenApiError,
  type DataFrameCompareResult,
  type DataFrameSlice,
  type TabularCompareBody,
} from '../lib/oxen/types'

export function DataFrameComparePage() {
  const { namespace = '', repo = '' } = useParams()
  const [params] = useSearchParams()
  const branches = useAsync(
    (signal) => listBranches(namespace, repo, signal),
    [namespace, repo],
  )

  const [leftVersion, setLeftVersion] = useState(params.get('base') || 'main')
  const [rightVersion, setRightVersion] = useState(
    params.get('head') || 'main',
  )
  const [leftPath, setLeftPath] = useState(params.get('path') || '')
  const [rightPath, setRightPath] = useState(params.get('path') || '')
  const [keys, setKeys] = useState('name')
  const [compareCols, setCompareCols] = useState('')
  const [displayCols, setDisplayCols] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [result, setResult] = useState<DataFrameCompareResult | null>(null)
  const [compareId, setCompareId] = useState<string | null>(null)
  const [diffRows, setDiffRows] = useState<DataFrameSlice | null>(null)
  const [diffPage, setDiffPage] = useState(1)

  const base = `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}`

  const branchNames = useMemo(
    () =>
      branches.kind === 'ok'
        ? branches.data.branches.map((b) => b.name)
        : ['main'],
    [branches],
  )

  function parseFields(raw: string) {
    return raw
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((name) => ({ left: name, right: name }))
  }

  function buildBody(id: string): TabularCompareBody {
    const keyFields = parseFields(keys)
    if (keyFields.length === 0) {
      throw new Error('At least one join key is required')
    }
    return {
      compare_id: id,
      left: { path: leftPath.trim(), version: leftVersion },
      right: { path: rightPath.trim(), version: rightVersion },
      keys: keyFields,
      compare: parseFields(compareCols),
      display: parseFields(displayCols),
    }
  }

  const [diffError, setDiffError] = useState<string | null>(null)

  async function loadDiff(
    id: string,
    path: string,
    left: string,
    right: string,
    page: number,
  ) {
    try {
      setDiffError(null)
      const diff = await getDataFrameCompareDiff(
        namespace,
        repo,
        id,
        path,
        left,
        right,
        { page, pageSize: 50 },
      )
      setDiffRows(diff.data_frame)
    } catch (err) {
      setDiffRows(null)
      setDiffError(
        err instanceof OxenApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to load derived rows',
      )
    }
  }

  async function runCompare(
    mode: 'create' | 'update' | 'reload',
  ) {
    setBusy(true)
    setError(null)
    setInfo(null)

    try {
      let id = compareId
      if (mode === 'create' || !id) {
        id =
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `dfcmp-${Date.now()}`
        setCompareId(id)
        setDiffPage(1)
      }

      const body = buildBody(id)
      const res =
        mode === 'create'
          ? await createDataFrameCompare(namespace, repo, body)
          : await updateDataFrameCompare(namespace, repo, id, body)

      setResult(res)
      await loadDiff(id, leftPath.trim(), leftVersion, rightVersion, diffPage)
      if (mode === 'update') setInfo('Compare updated via PUT.')
      if (mode === 'reload') setInfo('Compare reloaded via PUT + derived rows.')
    } catch (err) {
      setError(
        err instanceof OxenApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Compare failed',
      )
    } finally {
      setBusy(false)
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setResult(null)
    setDiffRows(null)
    void runCompare('create')
  }

  async function onDelete() {
    if (!compareId) return
    if (
      !(await confirmDelete({
        title: 'Delete data-frame compare',
        detail: `Compare “${compareId}” and its derived diff cache will be removed.`,
        confirmWord: 'DELETE',
      })
    )) {
      return
    }
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      await deleteDataFrameCompare(namespace, repo, compareId)
      setResult(null)
      setDiffRows(null)
      setCompareId(null)
      setInfo('Compare deleted.')
    } catch (err) {
      setError(
        err instanceof OxenApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Delete failed',
      )
    } finally {
      setBusy(false)
    }
  }

  const mods = result?.dfs?.summary?.modifications
  const schemaDiff = result?.dfs?.schema_diff
  const fields = diffRows?.view.schema.fields ?? []
  const rows = diffRows?.view.data ?? []
  const pagination = diffRows?.view.pagination

  return (
    <main className="page wide">
      <div className="page-head">
        <div>
          <Breadcrumbs
            items={repoCrumbs(namespace, repo, { label: 'Data frame compare' })}
          />
          <h1>Data frame compare</h1>
          <p className="lede">
            Tabular diff between two revisions of a data frame (join keys +
            compare columns). Edit/reload uses PUT (GET by id is unavailable).
          </p>
        </div>
        <Link className="btn ghost" to={`${base}/compare`}>
          File compare
        </Link>
      </div>

      <form className="panel form" onSubmit={onSubmit}>
        <div className="toolbar">
          <label className="branch-pick">
            Left revision
            <select
              value={leftVersion}
              onChange={(e) => setLeftVersion(e.target.value)}
            >
              {branchNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="branch-pick">
            Right revision
            <select
              value={rightVersion}
              onChange={(e) => setRightVersion(e.target.value)}
            >
              {branchNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Left path
          <input
            value={leftPath}
            onChange={(e) => setLeftPath(e.target.value)}
            placeholder="e.g. data/train.csv"
            required
          />
        </label>
        <label>
          Right path
          <input
            value={rightPath}
            onChange={(e) => setRightPath(e.target.value)}
            placeholder="same path or another frame"
            required
          />
        </label>
        <label>
          Join keys (comma-separated)
          <input
            value={keys}
            onChange={(e) => setKeys(e.target.value)}
            placeholder="name"
            required
          />
        </label>
        <label>
          Compare columns
          <input
            value={compareCols}
            onChange={(e) => setCompareCols(e.target.value)}
            placeholder="optional, e.g. label,score"
          />
        </label>
        <label>
          Display columns
          <input
            value={displayCols}
            onChange={(e) => setDisplayCols(e.target.value)}
            placeholder="optional extras to show"
          />
        </label>
        <div className="btn-row">
          <button type="submit" className="btn" disabled={busy}>
            {busy ? 'Working…' : 'Compare'}
          </button>
          {compareId && (
            <details className="more-actions">
              <summary className="btn ghost">Advanced</summary>
              <div className="more-actions-body">
                <button
                  type="button"
                  className="btn ghost"
                  disabled={busy}
                  onClick={() => void runCompare('update')}
                >
                  Update
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  disabled={busy}
                  onClick={() => void runCompare('reload')}
                >
                  Reload
                </button>
              </div>
            </details>
          )}
        </div>
      </form>

      {result && (
        <section className="panel">
          <div className="page-head">
            <h2 className="section-label">Result</h2>
            <button
              type="button"
              className="btn ghost danger"
              disabled={busy}
              onClick={() => void onDelete()}
            >
              Delete compare
            </button>
          </div>
          {compareId && (
            <details>
              <summary className="muted mono small" style={{ cursor: 'pointer' }}>
                compare_id
              </summary>
              <p className="muted mono">{compareId}</p>
            </details>
          )}
          {mods && (
            <dl className="kv">
              <div>
                <dt>Added rows</dt>
                <dd>{mods.added_rows ?? 0}</dd>
              </div>
              <div>
                <dt>Removed rows</dt>
                <dd>{mods.removed_rows ?? 0}</dd>
              </div>
              <div>
                <dt>Modified rows</dt>
                <dd>{mods.modified_rows ?? 0}</dd>
              </div>
            </dl>
          )}
          {schemaDiff && (
            <p className="muted">
              Schema: +{schemaDiff.added_cols?.length ?? 0} / −
              {schemaDiff.removed_cols?.length ?? 0} columns
            </p>
          )}
          {result.messages?.map((m, i) => (
            <p key={i} className={m.level === 'error' ? 'error' : 'muted'}>
              {m.title}
              {m.description ? ` — ${m.description}` : ''}
            </p>
          ))}
        </section>
      )}

      {diffError && (
        <p className="flash flash-error" role="status">Derived rows: {diffError}</p>
      )}

      {diffRows && (
        <section className="panel">
          <h2 className="section-label">Derived diff rows</h2>
          {rows.length === 0 ? (
            <p className="muted">No derived rows for this compare.</p>
          ) : (
            <div className="table-scroll">
              <table className="file-table df-table">
                <thead>
                  <tr>
                    {fields.map((f) => (
                      <th key={f.name}>
                        {f.name}
                        <span className="muted"> · {f.dtype}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i}>
                      {fields.map((f) => (
                        <td key={f.name}>
                          {row[f.name] == null ? '—' : String(row[f.name])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {pagination && pagination.total_pages > 1 && compareId && (
            <div className="btn-row">
              <button
                type="button"
                className="btn ghost"
                disabled={busy || diffPage <= 1}
                onClick={() => {
                  const next = Math.max(1, diffPage - 1)
                  setDiffPage(next)
                  void loadDiff(
                    compareId,
                    leftPath.trim(),
                    leftVersion,
                    rightVersion,
                    next,
                  )
                }}
              >
                Previous
              </button>
              <button
                type="button"
                className="btn ghost"
                disabled={busy || diffPage >= pagination.total_pages}
                onClick={() => {
                  const next = diffPage + 1
                  setDiffPage(next)
                  void loadDiff(
                    compareId,
                    leftPath.trim(),
                    leftVersion,
                    rightVersion,
                    next,
                  )
                }}
              >
                Next
              </button>
            </div>
          )}
        </section>
      )}

      {info && <p className="flash flash-success" role="status">{info}</p>}
      {error && <p className="flash flash-error" role="status">{error}</p>}
    </main>
  )
}
