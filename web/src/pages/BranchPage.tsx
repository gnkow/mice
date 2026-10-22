import { ArrowLeftRight as ActionArrowLeftRight, FolderOpen as ActionFolderOpen, GitMerge as ActionGitMerge, History as ActionHistory, RefreshCw as ActionRefreshCw, Trash2 as ActionTrash2 } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { AuthorAvatar } from '../components/AuthorAvatar'
import { MetaPanel } from '../components/MetaPanel'
import { StateBlock } from '../components/StateBlock'
import { useAsync } from '../hooks/useAsync'
import { confirmDelete } from '../lib/confirmDelete'
import { resolveDefaultBranch } from '../lib/lastBranch'
import { compareCommits, deleteBranch, getCommit, listBranches, mergeCommitIntoBranch, updateBranch } from '../lib/oxen/api'
import { formatRelativeTime } from '../lib/time'
import { FavoriteStar } from '../components/FavoriteStar'

export function BranchPage() {
  const { namespace = '', repo = '', branch = '' } = useParams()
  return <BranchDetail key={`${namespace}/${repo}@${branch}`} namespace={namespace} repo={repo} branch={branch} />
}

function BranchDetail({ namespace, repo, branch }: { namespace: string; repo: string; branch: string }) {
  const navigate = useNavigate()
  const { hash } = useLocation()
  const base = `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}`
  const encodedBranch = encodeURIComponent(branch)
  const state = useAsync(async signal => {
    const branches = await listBranches(namespace, repo, signal)
    const detail = branches.branches.find(b => b.name === branch)
    if (!detail) throw new Error(`Branch "${branch}" not found`)
    const defaultBranch = resolveDefaultBranch(branches.branches.map(b => b.name), namespace, repo)
    const commit = await getCommit(namespace, repo, detail.commit_id, signal)
    return { branch: detail, commit: commit.commit, defaultBranch }
  }, [namespace, repo, branch])
  const [commitId, setCommitId] = useState('')
  const [clientCommitId, setClientCommitId] = useState('')
  const [serverCommitId, setServerCommitId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const data = state.kind === 'ok' ? state.data : null
  const defaultBranch = data?.defaultBranch
  const comparison = useAsync(async signal => {
    if (!defaultBranch || branch === defaultBranch) return 0
    const result = await compareCommits(namespace, repo, defaultBranch, branch, signal)
    return result.compare.commits?.length ?? 0
  }, [namespace, repo, branch, defaultBranch, data?.branch.commit_id])
  const loaded = !!data
  useEffect(() => {
    if (loaded && (hash === '#metadata' || hash === '#power-tools')) {
      document.getElementById(hash.slice(1))?.scrollIntoView()
    }
  }, [hash, loaded])

  async function run(action: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      await action()
      state.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Branch action failed')
    } finally {
      setBusy(false)
    }
  }

  function onUpdate(e: FormEvent) {
    e.preventDefault()
    if (!commitId.trim()) return
    void run(async () => {
      await updateBranch(namespace, repo, branch, commitId.trim())
      setCommitId('')
      setInfo('Branch tip updated.')
    })
  }

  return <main className="page branch-page">
    <div className="page-head">
      <div>
        <Link to={`${base}/branches`} className="small">All branches</Link>
        <h1>Branch: <span className="mono">{branch}</span> <FavoriteStar type="branch" id={`${namespace}/${repo}@${branch}`} label={branch} /></h1>
      </div>
      <div className="btn-row">
        <Link className="btn ghost" to={`${base}/tree/${encodedBranch}`}><ActionFolderOpen size={14} aria-hidden="true" className="button-label-icon" />Browse files</Link>
        <Link className="btn ghost" to={`${base}/commits?branch=${encodedBranch}`}><ActionHistory size={14} aria-hidden="true" className="button-label-icon" />History</Link>
        {data && branch !== data.defaultBranch && <Link className="btn ghost" to={`${base}/compare?base=${encodeURIComponent(data.defaultBranch)}&head=${encodedBranch}`}><ActionArrowLeftRight size={14} aria-hidden="true" className="button-label-icon" />Compare</Link>}
      </div>
    </div>
    {info && <p className="flash flash-success" role="status">{info}</p>}
    {error && <p className="flash flash-error" role="alert">{error}</p>}
    <StateBlock loading={state.kind === 'loading'} error={state.kind === 'error' ? state.message : null} onRetry={state.reload}>
      {data && <>
        <section className="panel" aria-labelledby="branch-info-heading">
          <h2 id="branch-info-heading">Branch info</h2>
          <dl>
            <dt>Name</dt><dd className="mono">{branch} {branch === data.defaultBranch && <span className="pill default-branch">default</span>}</dd>
            <dt>Tip commit</dt><dd><Link className="mono" to={`${base}/commits/${encodeURIComponent(data.commit.id)}`}>{data.commit.id}</Link></dd>
            <dt>Message</dt><dd>{data.commit.message}</dd>
            <dt>Author</dt><dd><AuthorAvatar name={data.commit.author || 'unknown'} /> {data.commit.author || 'unknown'}</dd>
            <dt>Updated</dt><dd title={data.commit.timestamp}>{formatRelativeTime(data.commit.timestamp)}</dd>
            {branch !== data.defaultBranch && <><dt>Commits ahead of {data.defaultBranch}</dt><dd>
              <StateBlock loading={comparison.kind === 'loading'} error={comparison.kind === 'error' ? comparison.message : null} onRetry={comparison.reload}>
                {comparison.kind === 'ok' ? comparison.data : null}
              </StateBlock>
            </dd></>}
          </dl>
        </section>
        <section id="metadata" aria-label="Branch metadata">
          <MetaPanel type="branch" id={`${namespace}/${repo}@${branch}`} defaultOpen />
        </section>
        <details id="power-tools" className="panel" open>
          <summary>Power tools</summary>
          <fieldset className="meta-editable" disabled={busy}>
            <h3 className="subhead">Point branch at commit</h3>
            <form className="form" onSubmit={onUpdate}>
              <label>Commit ID<input value={commitId} onChange={e => setCommitId(e.target.value)} placeholder={data.branch.commit_id} className="mono" required /></label>
              <button className="btn ghost" type="submit" disabled={!commitId.trim()}><ActionRefreshCw size={14} aria-hidden="true" className="button-label-icon" />Update tip</button>
            </form>
            <h3 className="subhead">Merge commit into branch</h3>
            <p className="muted small">Combine an incoming (client) commit with the branch tip (server). On conflict the server tip is unchanged. To merge branches, use the <Link to={`${base}/merge`}>Merge</Link> page.</p>
            <form className="form" onSubmit={e => {
              e.preventDefault()
              if (!clientCommitId.trim()) return
              void run(async () => {
                const res = await mergeCommitIntoBranch(namespace, repo, branch, clientCommitId.trim(), serverCommitId.trim() || data.branch.commit_id)
                setInfo(`Branch tip after merge: ${res.commit.id.slice(0, 12)} — ${res.commit.message}`)
                setClientCommitId('')
                setServerCommitId('')
              })
            }}>
              <label>Client commit (incoming)<input value={clientCommitId} onChange={e => setClientCommitId(e.target.value)} placeholder="commit id to merge in" required className="mono" /></label>
              <label>Server commit (branch tip)<input value={serverCommitId} onChange={e => setServerCommitId(e.target.value)} placeholder={data.branch.commit_id} className="mono" /></label>
              <button className="btn" type="submit" disabled={!clientCommitId.trim()}><ActionGitMerge size={14} aria-hidden="true" className="button-label-icon" />Merge into branch</button>
            </form>
            <h3 className="subhead">Delete branch</h3>
            <button className="btn ghost" type="button" disabled={branch === data.defaultBranch} onClick={async () => {
              if (branch === data.defaultBranch || !await confirmDelete({
                title: `Delete branch ${branch}`, detail: `Branch "${branch}" will be removed from ${namespace}/${repo}. Commits may become unreachable.`, confirmWord: branch,
              })) return
              void run(async () => {
                await deleteBranch(namespace, repo, branch)
                navigate(`${base}/branches`)
              })
            }}><ActionTrash2 size={14} aria-hidden="true" className="button-label-icon" />{branch === data.defaultBranch ? 'Cannot delete default branch' : 'Delete branch'}</button>
          </fieldset>
        </details>
      </>}
    </StateBlock>
  </main>
}
