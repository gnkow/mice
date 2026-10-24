import { useEffect, useMemo } from 'react'
import { CommitSelector } from './CommitSelector'
import { useAsync } from '../hooks/useAsync'
import { resolveDefaultBranch } from '../lib/lastBranch'
import { listBranches } from '../lib/oxen/api'

export type NewWorkspaceDraft = {
  repoKey: string
  name: string
  sourceKind: 'branch' | 'commit'
  branch: string
  commit: string
}

export function emptyNewWorkspace(repoKey = ''): NewWorkspaceDraft {
  return { repoKey, name: '', sourceKind: 'branch', branch: '', commit: '' }
}

export function newWorkspaceInput(d: NewWorkspaceDraft) {
  const [namespace = '', repo = ''] = d.repoKey.split('/')
  return {
    namespace,
    repo,
    name: d.name.trim() || undefined,
    source: d.sourceKind === 'branch' ? { branch: d.branch } : { commit: d.commit },
  }
}

/** Repository / source / name fields shared by on-demand workspace creation. */
export function NewWorkspaceFields({
  draft,
  onChange,
  repos,
  disabled,
}: {
  draft: NewWorkspaceDraft
  onChange: (d: NewWorkspaceDraft) => void
  repos: { namespace: string; name: string }[]
  disabled?: boolean
}) {
  const active = draft.repoKey || (repos[0] ? `${repos[0].namespace}/${repos[0].name}` : '')
  const [namespace = '', repo = ''] = active.split('/')
  const branches = useAsync(
    (signal) => (namespace && repo ? listBranches(namespace, repo, signal) : Promise.resolve(null)),
    [namespace, repo],
  )
  const names = useMemo(
    () => (branches.kind === 'ok' && branches.data ? branches.data.branches.map((b) => b.name) : []),
    [branches],
  )
  const activeBranch = names.includes(draft.branch) ? draft.branch : resolveDefaultBranch(names, namespace, repo)
  const set = (patch: Partial<NewWorkspaceDraft>) => onChange({ ...draft, repoKey: active, ...patch })
  useEffect(() => {
    if (activeBranch && (draft.branch !== activeBranch || draft.repoKey !== active)) {
      onChange({ ...draft, repoKey: active, branch: activeBranch })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBranch, active])

  const trimmed = draft.name.trim()
  return (
    <div className="form-section">
      <label>
        Workspace name
        <input
          value={draft.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="Optional — w_id-branch-commit_short"
          aria-invalid={trimmed.length === 1}
          disabled={disabled}
        />
      </label>
      {trimmed.length === 1 && <p className="field-hint error-text">at least 2 characters</p>}
      {repos.length !== 1 && (
        <label>
          Repository
          <select
            value={active}
            onChange={(e) => set({ repoKey: e.target.value, branch: '', commit: '' })}
            disabled={disabled}
            aria-label="Repository"
          >
            {repos.map((r) => (
              <option key={`${r.namespace}/${r.name}`} value={`${r.namespace}/${r.name}`}>
                {r.namespace}/{r.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Source type
        <select
          value={draft.sourceKind}
          onChange={(e) => set({ sourceKind: e.target.value as 'branch' | 'commit', commit: '' })}
          disabled={disabled}
          aria-label="Source type"
        >
          <option value="branch">Branch</option>
          <option value="commit">Commit</option>
        </select>
      </label>
      <label>
        {draft.sourceKind === 'commit' ? 'Branch to pick the commit from' : 'Source branch'}
        <select
          value={activeBranch}
          onChange={(e) => set({ branch: e.target.value, commit: '' })}
          disabled={disabled}
          aria-label={draft.sourceKind === 'commit' ? 'Commit branch' : 'Source branch'}
        >
          {names.length > 0 ? (
            names.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))
          ) : (
            <option value={activeBranch}>{activeBranch}</option>
          )}
        </select>
      </label>
      {draft.sourceKind === 'commit' && activeBranch && (
        <CommitSelector
          namespace={namespace}
          repo={repo}
          branch={activeBranch}
          value={draft.commit}
          onChange={(commit) => set({ commit })}
          label="Commit"
          disabled={disabled}
        />
      )}
    </div>
  )
}
