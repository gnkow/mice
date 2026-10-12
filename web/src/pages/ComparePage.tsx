import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Breadcrumbs, repoCrumbs } from '../components/Breadcrumbs'
import { pickOtherBranch } from '../lib/lastBranch'
import { CommitList } from '../components/CommitList'
import { StateBlock } from '../components/StateBlock'
import { useAsync } from '../hooks/useAsync'
import {
  compareCommits,
  compareDirTree,
  compareEntries,
  compareFile,
  listBranches,
} from '../lib/oxen/api'
import type { CompareDirNode } from '../lib/oxen/types'

function DirTreeList({ nodes, depth = 0 }: { nodes: CompareDirNode[]; depth?: number }) {
  if (nodes.length === 0) return null
  return (
    <ul className="plain-list" style={{ marginLeft: depth ? '1rem' : 0 }}>
      {nodes.map((n) => (
        <li key={`${n.name}-${n.status}-${depth}`}>
          <span className={`pill ${n.status}`}>{n.status}</span>{' '}
          <code>{n.name || '(root)'}</code>
          {n.children && n.children.length > 0 && (
            <DirTreeList nodes={n.children} depth={depth + 1} />
          )}
        </li>
      ))}
    </ul>
  )
}

export function ComparePage() {
  const { namespace = '', repo = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const base = params.get('base') || 'main'
  const head = params.get('head') || 'main'
  const pathFilter = params.get('path') || ''
  const [pathDraft, setPathDraft] = useState(pathFilter)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)

  const branches = useAsync(
    (signal) => listBranches(namespace, repo, signal),
    [namespace, repo],
  )

  const rangeKey = `${base}..${head}`
  const canCompare = base !== head

  const entries = useAsync(
    (signal) =>
      canCompare
        ? compareEntries(
            namespace,
            repo,
            base,
            head,
            signal,
            pathFilter.trim() || undefined,
          )
        : Promise.resolve(null),
    [namespace, repo, base, head, canCompare, pathFilter],
  )

  const commits = useAsync(
    (signal) =>
      canCompare
        ? compareCommits(namespace, repo, base, head, signal)
        : Promise.resolve(null),
    [namespace, repo, base, head, canCompare],
  )

  const dirTree = useAsync(
    (signal) =>
      canCompare
        ? compareDirTree(namespace, repo, base, head, signal)
        : Promise.resolve(null),
    [namespace, repo, base, head, canCompare],
  )

  const fileDiff = useAsync(
    (signal) =>
      selectedFile && canCompare
        ? compareFile(namespace, repo, base, head, selectedFile, signal)
        : Promise.resolve(null),
    [namespace, repo, base, head, selectedFile, canCompare],
  )

  const branchNames = useMemo(
    () =>
      branches.kind === 'ok'
        ? branches.data.branches.map((b) => b.name)
        : ['main'],
    [branches],
  )

  const didAutoRange = useRef(false)
  useEffect(() => {
    if (branches.kind !== 'ok' || didAutoRange.current) return
    if (base !== head) {
      didAutoRange.current = true
      return
    }
    const other = pickOtherBranch(
      branches.data.branches.map((b) => b.name),
      base,
    )
    if (other) {
      didAutoRange.current = true
      setSelectedFile(null)
      const next: Record<string, string> = { base, head: other }
      if (pathFilter.trim()) next.path = pathFilter.trim()
      setParams(next)
    }
  }, [branches, base, head, pathFilter, setParams])

  function setRange(nextBase: string, nextHead: string, path = pathFilter) {
    setSelectedFile(null)
    const next: Record<string, string> = { base: nextBase, head: nextHead }
    if (path.trim()) next.path = path.trim()
    setParams(next)
  }

  return (
    <main className="page wide">
      <div className="page-head">
        <div>
          <Breadcrumbs items={repoCrumbs(namespace, repo, { label: 'Compare' })} />
          <h1>Compare</h1>
          <p className="lede mono">{rangeKey}</p>
        </div>
        <div className="btn-row">
          <Link
            className="btn ghost"
            to={`/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}/df-compare?base=${encodeURIComponent(base)}&head=${encodeURIComponent(head)}`}
          >
            DF compare
          </Link>
          <Link
            className="btn ghost"
            to={`/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}/merge?base=${encodeURIComponent(base)}&head=${encodeURIComponent(head)}`}
          >
            Merge…
          </Link>
        </div>
      </div>

      <div className="toolbar">
        <label className="branch-pick">
          Base
          <select
            value={base}
            onChange={(e) => setRange(e.target.value, head)}
          >
            {branchNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="branch-pick">
          Head
          <select
            value={head}
            onChange={(e) => setRange(base, e.target.value)}
          >
            {branchNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="branch-pick">
          Under directory
          <input
            value={pathDraft}
            onChange={(e) => setPathDraft(e.target.value)}
            onBlur={() => {
              if (pathDraft.trim() !== pathFilter.trim()) {
                setRange(base, head, pathDraft)
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                setRange(base, head, pathDraft)
              }
            }}
            placeholder="e.g. data (empty = all)"
          />
        </label>
      </div>

      {!canCompare && (
        <p className="muted">Pick two different revisions to compare.</p>
      )}

      {canCompare && (
        <>
          <div className="compare-summary">
            <span>
              {commits.kind === 'ok' && commits.data
                ? `${commits.data.compare.commits.length} commits`
                : commits.kind === 'loading'
                  ? '… commits'
                  : '— commits'}
            </span>
            <span className="muted">·</span>
            <span>
              {entries.kind === 'ok' && entries.data
                ? `${entries.data.total_entries ?? entries.data.compare.entries.length} files changed`
                : entries.kind === 'loading'
                  ? '… files'
                  : '— files'}
            </span>
            <span className="muted mono">{rangeKey}</span>
          </div>

          <StateBlock
            loading={dirTree.kind === 'loading'}
            error={dirTree.kind === 'error' ? dirTree.message : null}
          >
            {dirTree.kind === 'ok' && dirTree.data && (
              <section className="panel">
                <h2 className="section-label">Directory tree</h2>
                {dirTree.data.dirs.length === 0 ? (
                  <p className="muted">No directory changes in this range.</p>
                ) : (
                  <DirTreeList nodes={dirTree.data.dirs} />
                )}
              </section>
            )}
          </StateBlock>

          <StateBlock
            loading={entries.kind === 'loading'}
            error={entries.kind === 'error' ? entries.message : null}
          >
            {entries.kind === 'ok' && entries.data && (
              <section className="panel">
                <h2 className="section-label">
                  Changed files
                  {pathFilter.trim() ? (
                    <span className="muted"> under {pathFilter.trim()}</span>
                  ) : null}
                </h2>
                <p className="muted small">
                  +{entries.data.compare.counts.added} / −
                  {entries.data.compare.counts.removed} / ~
                  {entries.data.compare.counts.modified}
                  {entries.data.total_entries != null
                    ? ` · ${entries.data.total_entries} entries`
                    : ''}
                </p>
                {entries.data.compare.entries.length === 0 ? (
                  <p className="muted">No file changes in this range.</p>
                ) : (
                  <table className="file-table">
                    <thead>
                      <tr>
                        <th>Status</th>
                        <th>Path</th>
                        <th>Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.data.compare.entries.map((entry) => (
                        <tr
                          key={entry.filename}
                          className={
                            selectedFile === entry.filename ? 'selected' : ''
                          }
                        >
                          <td>
                            <span className={`pill ${entry.status}`}>
                              {entry.status}
                            </span>
                          </td>
                          <td>
                            <button
                              type="button"
                              className="linkish"
                              onClick={() => setSelectedFile(entry.filename)}
                            >
                              {entry.filename}
                            </button>
                          </td>
                          <td className="muted">{entry.data_type ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            )}
          </StateBlock>

          <section className="panel">
            <h2 className="section-label">File diff</h2>
            {!selectedFile && (
              <p className="muted">Select a file to view its diff.</p>
            )}
            <StateBlock
              loading={fileDiff.kind === 'loading'}
              error={fileDiff.kind === 'error' ? fileDiff.message : null}
            >
              {fileDiff.kind === 'ok' && fileDiff.data && (
                <>
                  <p className="muted small">
                    {fileDiff.data.compare.filename} ·{' '}
                    {fileDiff.data.compare.status}
                  </p>
                  {fileDiff.data.compare.diff?.lines ? (
                    <pre className="code-preview diff-preview">
                      {fileDiff.data.compare.diff.lines.map((line, i) => (
                        <div
                          key={`${i}-${line.modification}`}
                          className={`diff-line ${line.modification.toLowerCase()}`}
                        >
                          <span className="diff-mark">
                            {line.modification === 'Added'
                              ? '+'
                              : line.modification === 'Removed'
                                ? '-'
                                : ' '}
                          </span>
                          {line.text}
                        </div>
                      ))}
                    </pre>
                  ) : (
                    <p className="muted">No line-level diff for this file.</p>
                  )}
                </>
              )}
            </StateBlock>
          </section>

          <section className="panel">
            <h2 className="section-label">Commits in range</h2>
            <StateBlock
              loading={commits.kind === 'loading'}
              error={commits.kind === 'error' ? commits.message : null}
              empty={
                commits.kind === 'ok' &&
                !!commits.data &&
                commits.data.compare.commits.length === 0
              }
              emptyMessage="No exclusive commits in this two-dot range."
            >
              {commits.kind === 'ok' && commits.data && (
                <CommitList
                  namespace={namespace}
                  repo={repo}
                  commits={commits.data.compare.commits}
                />
              )}
            </StateBlock>
          </section>
        </>
      )}
    </main>
  )
}
