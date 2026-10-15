import { oxenFetch } from './client'
import {
  baseHead,
  baseName,
  looksLikeCommitId,
  resourcePath,
} from './paths'
import { loadSettings } from './settings'
import { extractGzipTar } from './tar'
import type {
  BranchResponse,
  CommitResponse,
  CompareCommitsResponse,
  CompareDirTreeResponse,
  CompareEntriesResponse,
  CompareEntryResponse,
  CreateRepoInput,
  DataFrameSliceResponse,
  ListBranchesResponse,
  ListCommitsResponse,
  ListNamespacesResponse,
  ListRepositoryResponse,
  ListWorkspacesResponse,
  MergeSuccessResponse,
  MergeableResponse,
  MetadataEntryResponse,
  NamespaceResponse,
  OxenVersionResponse,
  PaginatedDirEntriesResponse,
  DataFrameCompareResult,
  PaginatedEntryVersionsResponse,
  RemoteStagedStatusResponse,
  RepoSizeFile,
  RepositoryCreationResponse,
  RepositoryDataTypesResponse,
  RepositoryStatsResponse,
  StatusMessage,
  TabularCompareBody,
  VersionFileResponse,
  WorkspaceResponse,
} from './types'
import { OxenApiError } from './types'
import { xxh128File } from './hash'

function repoBase(namespace: string, repo: string) {
  return `/api/repos/${encodeURIComponent(namespace)}/${encodeURIComponent(repo)}`
}

/** Placeholder author fields; the auth BFF overwrites these from the session. */
function authorFields() {
  return { name: 'boxen', email: 'boxen@localhost' }
}

export function fetchServerVersion(signal?: AbortSignal) {
  return oxenFetch<OxenVersionResponse>('/api/version', { signal })
}

export function listNamespaces(signal?: AbortSignal) {
  return oxenFetch<ListNamespacesResponse>('/api/namespaces', { signal })
}

export function getNamespace(namespace: string, signal?: AbortSignal) {
  return oxenFetch<NamespaceResponse>(
    `/api/namespaces/${encodeURIComponent(namespace)}`,
    { signal },
  )
}

export function listRepositories(namespace: string, signal?: AbortSignal) {
  return oxenFetch<ListRepositoryResponse>(
    `/api/repos/${encodeURIComponent(namespace)}`,
    { signal },
  )
}

export function getRepository(
  namespace: string,
  repo: string,
  signal?: AbortSignal,
) {
  return oxenFetch<RepositoryDataTypesResponse>(
    `/api/repos/${encodeURIComponent(namespace)}/${encodeURIComponent(repo)}`,
    { signal },
  )
}

export function createRepository(input: CreateRepoInput, signal?: AbortSignal) {
  return oxenFetch<RepositoryCreationResponse>('/api/repos', {
    method: 'POST',
    body: input,
    signal,
  })
}

export function deleteRepository(
  namespace: string,
  repo: string,
  signal?: AbortSignal,
) {
  return oxenFetch<StatusMessage>(
    `/api/repos/${encodeURIComponent(namespace)}/${encodeURIComponent(repo)}`,
    { method: 'DELETE', signal },
  )
}

export function renameRepository(
  namespace: string,
  repo: string,
  repoName: string,
  signal?: AbortSignal,
) {
  return oxenFetch<StatusMessage>(
    `/api/repos/${encodeURIComponent(namespace)}/${encodeURIComponent(repo)}/rename`,
    { method: 'PATCH', body: { repo_name: repoName }, signal },
  )
}

export function transferRepository(
  namespace: string,
  repo: string,
  targetNamespace: string,
  signal?: AbortSignal,
) {
  return oxenFetch<RepositoryDataTypesResponse>(
    `/api/repos/${encodeURIComponent(namespace)}/${encodeURIComponent(repo)}/transfer`,
    {
      method: 'PATCH',
      body: { namespace: targetNamespace },
      signal,
    },
  )
}

export function getRepositoryStats(
  namespace: string,
  repo: string,
  signal?: AbortSignal,
) {
  return oxenFetch<RepositoryStatsResponse>(
    `/api/repos/${encodeURIComponent(namespace)}/${encodeURIComponent(repo)}/stats`,
    { signal },
  )
}

export function getRepositorySize(
  namespace: string,
  repo: string,
  signal?: AbortSignal,
) {
  return oxenFetch<RepoSizeFile>(
    `/api/repos/${encodeURIComponent(namespace)}/${encodeURIComponent(repo)}/size`,
    { signal },
  )
}

export function updateRepositorySize(
  namespace: string,
  repo: string,
  signal?: AbortSignal,
) {
  return oxenFetch<StatusMessage>(
    `${repoBase(namespace, repo)}/size`,
    { method: 'POST', signal },
  )
}

export function listDirectory(
  namespace: string,
  repo: string,
  branch: string,
  path = '',
  signal?: AbortSignal,
) {
  const resource = resourcePath(branch, path)
  return oxenFetch<PaginatedDirEntriesResponse>(
    `${repoBase(namespace, repo)}/dir/${resource}`,
    { signal },
  )
}

export function getFileMetadata(
  namespace: string,
  repo: string,
  branch: string,
  path: string,
  signal?: AbortSignal,
) {
  // Live oxen-server exposes `/meta/` (OpenAPI lists `/metadata/`).
  const resource = resourcePath(branch, path)
  return oxenFetch<MetadataEntryResponse>(
    `${repoBase(namespace, repo)}/meta/${resource}`,
    { signal },
  )
}

/**
 * Recompute derived entry/tree metadata for a revision (sizes, type counts, text stats).
 * Live: POST /meta/{resource} (OpenAPI wrongly documents PUT /metadata/…).
 * Does not accept custom user JSON — body is ignored by the server.
 */
export function refreshEntryMetadata(
  namespace: string,
  repo: string,
  revision: string,
  path = '',
  signal?: AbortSignal,
) {
  const resource = resourcePath(revision, path)
  return oxenFetch<StatusMessage>(
    `${repoBase(namespace, repo)}/meta/${resource}`,
    { method: 'POST', signal },
  )
}

export async function downloadFile(
  namespace: string,
  repo: string,
  branch: string,
  path: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const resource = resourcePath(branch, path)
  const res = await oxenFetch<Response>(
    `${repoBase(namespace, repo)}/file/${resource}`,
    { signal, raw: true },
  )
  return res.blob()
}

export async function downloadFileText(
  namespace: string,
  repo: string,
  branch: string,
  path: string,
  signal?: AbortSignal,
): Promise<string> {
  const resource = resourcePath(branch, path)
  const res = await oxenFetch<Response>(
    `${repoBase(namespace, repo)}/file/${resource}`,
    { signal, raw: true },
  )
  return res.text()
}

export function uploadFile(
  namespace: string,
  repo: string,
  branch: string,
  destPath: string,
  file: File,
  message: string,
  signal?: AbortSignal,
  opts?: { copyFrom?: string; restoreFrom?: string },
) {
  const resource = resourcePath(branch, destPath)
  const form = new FormData()
  form.append('file', file, file.name)
  form.append('message', message)
  const author = authorFields()
  form.append('name', author.name)
  form.append('email', author.email)
  if (opts?.copyFrom?.trim()) {
    form.append('copy_from', opts.copyFrom.trim().replace(/^\/+/, ''))
  }
  if (opts?.restoreFrom?.trim()) {
    form.append('restore_from', opts.restoreFrom.trim())
  }
  return oxenFetch<CommitResponse>(
    `${repoBase(namespace, repo)}/file/${resource}`,
    { method: 'PUT', formData: form, signal },
  )
}

/**
 * Restore a deleted path on `targetBranch` from a historical revision
 * (commit id or branch tip that still has the file). Same path only.
 */
export async function restoreFile(
  namespace: string,
  repo: string,
  targetBranch: string,
  path: string,
  sourceRevision: string,
  message: string,
  signal?: AbortSignal,
) {
  const dest = path.replace(/^\/+/, '')
  const revision = sourceRevision.trim()
  if (!dest || !revision) {
    throw new OxenApiError('Restore requires a path and source revision', 400, null)
  }
  if (looksLikeCommitId(targetBranch)) {
    throw new OxenApiError(
      'Restore requires a branch to write to (not a commit hash)',
      400,
      null,
    )
  }
  let blob: Blob
  try {
    blob = await downloadFile(namespace, repo, revision, dest, signal)
  } catch {
    blob = await downloadVersionResource(
      namespace,
      repo,
      revision,
      dest,
      signal,
    )
  }
  const file = new File([blob], baseName(dest), {
    type: blob.type || 'application/octet-stream',
  })
  return uploadFile(
    namespace,
    repo,
    targetBranch,
    dest,
    file,
    message,
    signal,
    { restoreFrom: revision },
  )
}

/**
 * Copy a file to a new path (same basename required). Implemented as
 * download + upload; BFF records explicit lineage via `copy_from`.
 *
 * `sourceRevision` may be a branch or commit hash (read). Writes always go to
 * `targetBranch` (must be a real branch — oxen rejects PUT on a commit id).
 */
export async function copyFile(
  namespace: string,
  repo: string,
  sourceRevision: string,
  fromPath: string,
  toPath: string,
  message: string,
  signal?: AbortSignal,
  opts?: { targetBranch?: string },
) {
  const from = fromPath.replace(/^\/+/, '')
  const to = toPath.replace(/^\/+/, '')
  if (!from || !to || from === to) {
    throw new OxenApiError('Copy requires a different destination path', 400, null)
  }
  if (baseName(from) !== baseName(to)) {
    throw new OxenApiError(
      'Copy must keep the same file name; only change the folder',
      400,
      null,
    )
  }
  const targetBranch = (opts?.targetBranch ?? sourceRevision).trim()
  if (!targetBranch || looksLikeCommitId(targetBranch)) {
    throw new OxenApiError(
      'Copy requires a branch to write to (not a commit hash)',
      400,
      null,
    )
  }
  const blob = await downloadFile(
    namespace,
    repo,
    sourceRevision,
    from,
    signal,
  )
  const file = new File([blob], baseName(to), {
    type: blob.type || 'application/octet-stream',
  })
  return uploadFile(namespace, repo, targetBranch, to, file, message, signal, {
    copyFrom: from,
  })
}

export function deleteFile(
  namespace: string,
  repo: string,
  branch: string,
  path: string,
  message: string,
  signal?: AbortSignal,
) {
  const resource = resourcePath(branch, path)
  const form = new FormData()
  form.append('message', message)
  const author = authorFields()
  form.append('name', author.name)
  form.append('email', author.email)
  return oxenFetch<CommitResponse>(
    `${repoBase(namespace, repo)}/file/${resource}`,
    { method: 'DELETE', formData: form, signal },
  )
}

export function moveFile(
  namespace: string,
  repo: string,
  branch: string,
  path: string,
  newPath: string,
  message: string,
  signal?: AbortSignal,
) {
  const resource = resourcePath(branch, path)
  const author = authorFields()
  return oxenFetch<CommitResponse>(
    `${repoBase(namespace, repo)}/file/${resource}`,
    {
      method: 'PATCH',
      body: {
        new_path: newPath,
        message,
        name: author.name,
        email: author.email,
      },
      signal,
    },
  )
}

export function listBranches(
  namespace: string,
  repo: string,
  signal?: AbortSignal,
) {
  return oxenFetch<ListBranchesResponse>(
    `${repoBase(namespace, repo)}/branches`,
    { signal },
  )
}

export function getBranch(
  namespace: string,
  repo: string,
  branch: string,
  signal?: AbortSignal,
) {
  return oxenFetch<BranchResponse>(
    `${repoBase(namespace, repo)}/branches/${encodeURIComponent(branch)}`,
    { signal },
  )
}

export function createBranch(
  namespace: string,
  repo: string,
  newName: string,
  fromName: string,
  signal?: AbortSignal,
) {
  return oxenFetch<BranchResponse>(`${repoBase(namespace, repo)}/branches`, {
    method: 'POST',
    body: { new_name: newName, from_name: fromName },
    signal,
  })
}

export function updateBranch(
  namespace: string,
  repo: string,
  branch: string,
  commitId: string,
  signal?: AbortSignal,
) {
  return oxenFetch<BranchResponse>(
    `${repoBase(namespace, repo)}/branches/${encodeURIComponent(branch)}`,
    { method: 'PUT', body: { commit_id: commitId }, signal },
  )
}

export function deleteBranch(
  namespace: string,
  repo: string,
  branch: string,
  signal?: AbortSignal,
) {
  return oxenFetch<BranchResponse>(
    `${repoBase(namespace, repo)}/branches/${encodeURIComponent(branch)}`,
    { method: 'DELETE', signal },
  )
}

/**
 * Push-path merge: combine client commit into branch tip (server commit).
 * Live oxen-server uses PUT (OpenAPI lists POST).
 */
export function mergeCommitIntoBranch(
  namespace: string,
  repo: string,
  branch: string,
  clientCommitId: string,
  serverCommitId: string,
  signal?: AbortSignal,
) {
  return oxenFetch<CommitResponse>(
    `${repoBase(namespace, repo)}/branches/${encodeURIComponent(branch)}/merge`,
    {
      method: 'PUT',
      body: {
        client_commit_id: clientCommitId,
        server_commit_id: serverCommitId,
      },
      signal,
    },
  )
}

export function listAllCommits(
  namespace: string,
  repo: string,
  signal?: AbortSignal,
) {
  return oxenFetch<ListCommitsResponse>(
    `${repoBase(namespace, repo)}/commits/all`,
    { signal },
  )
}

/**
 * Commit history for a revision, optionally filtered to commits that touch a path.
 * Live: GET …/commits/history/{revision}/{path?}  (?path= query is ignored)
 */
export function listCommitHistory(
  namespace: string,
  repo: string,
  revision: string,
  signal?: AbortSignal,
  path?: string,
) {
  const resource = resourcePath(revision, path?.trim() || '')
  return oxenFetch<ListCommitsResponse>(
    `${repoBase(namespace, repo)}/commits/history/${resource}`,
    { signal },
  )
}

export function getCommit(
  namespace: string,
  repo: string,
  commitId: string,
  signal?: AbortSignal,
) {
  return oxenFetch<CommitResponse>(
    `${repoBase(namespace, repo)}/commits/${encodeURIComponent(commitId)}`,
    { signal },
  )
}

export function getRootCommit(
  namespace: string,
  repo: string,
  signal?: AbortSignal,
) {
  return oxenFetch<CommitResponse>(
    `${repoBase(namespace, repo)}/commits/root`,
    { signal },
  )
}

export function getCommitParents(
  namespace: string,
  repo: string,
  commitOrBranch: string,
  signal?: AbortSignal,
) {
  return oxenFetch<ListCommitsResponse>(
    `${repoBase(namespace, repo)}/commits/${encodeURIComponent(commitOrBranch)}/parents`,
    { signal },
  )
}

export function compareCommits(
  namespace: string,
  repo: string,
  base: string,
  head: string,
  signal?: AbortSignal,
) {
  // Live oxen-server: /compare/commits/{base}..{head} (OpenAPI lists the reverse order)
  return oxenFetch<CompareCommitsResponse>(
    `${repoBase(namespace, repo)}/compare/commits/${baseHead(base, head)}`,
    { signal },
  )
}

export function compareEntries(
  namespace: string,
  repo: string,
  base: string,
  head: string,
  signal?: AbortSignal,
  directory?: string,
) {
  const dir = directory
    ?.split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/')
  const suffix = dir ? `/dir/${dir}` : directory?.trim() === '.' ? '/dir/.' : ''
  return oxenFetch<CompareEntriesResponse>(
    `${repoBase(namespace, repo)}/compare/entries/${baseHead(base, head)}${suffix}`,
    { signal },
  )
}

export type DeletedPathHint = {
  path: string
  filename: string
  /** Revision where the file still existed (parent of tip). */
  sourceRevision: string
  size?: number
  dataType?: string
}

/**
 * Files removed in `revision` (branch or commit) relative to its first parent,
 * scoped to a directory (direct children only). Used to offer Restore in the
 * tree UI when browsing a tip or a historical commit.
 *
 * Note: oxen `GET …/commits/{ref}/parents` returns the ancestry list starting
 * with the tip itself — use `tip.parent_ids[0]`, not `commits[0].id`.
 */
export async function listDeletedInLatestCommit(
  namespace: string,
  repo: string,
  revision: string,
  directory = '',
  signal?: AbortSignal,
): Promise<DeletedPathHint[]> {
  const ancestry = await getCommitParents(namespace, repo, revision, signal)
  const tip = ancestry.commits[0]
  const parentId = tip?.parent_ids?.[0]
  // Prefer the resolved commit id so compare works the same for branch names
  // and when the tree URL already points at a commit hash.
  const head = tip?.id?.trim() || revision
  if (!parentId) return []

  const dir = directory.replace(/^\/+|\/+$/g, '')
  let entries
  try {
    const cmp = await compareEntries(
      namespace,
      repo,
      parentId,
      head,
      signal,
      dir || undefined,
    )
    entries = cmp.compare.entries
  } catch {
    // Fallback: unscoped compare, then filter to this directory.
    const cmp = await compareEntries(
      namespace,
      repo,
      parentId,
      head,
      signal,
    )
    entries = cmp.compare.entries
  }

  const out: DeletedPathHint[] = []
  for (const e of entries) {
    if (e.status !== 'removed' || e.is_dir) continue
    const full = e.filename.replace(/^\/+/, '')
    let path = full
    if (dir) {
      if (full === dir || full.startsWith(`${dir}/`)) {
        const rest = full.slice(dir.length).replace(/^\//, '')
        if (!rest || rest.includes('/')) continue
        path = full
      } else if (!full.includes('/')) {
        path = [dir, full].filter(Boolean).join('/')
      } else {
        continue
      }
    } else if (full.includes('/')) {
      continue
    }
    out.push({
      path,
      filename: baseName(path),
      sourceRevision: parentId,
      size: e.base_entry?.size ?? e.size,
      dataType: e.data_type,
    })
  }
  return out
}

export function compareFile(
  namespace: string,
  repo: string,
  base: string,
  head: string,
  path: string,
  signal?: AbortSignal,
) {
  const filePath = path
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/')
  return oxenFetch<CompareEntryResponse>(
    `${repoBase(namespace, repo)}/compare/file/${baseHead(base, head)}/${filePath}`,
    { signal },
  )
}

/** Live oxen-server: GET /compare/dir_tree/{base}..{head} */
export function compareDirTree(
  namespace: string,
  repo: string,
  base: string,
  head: string,
  signal?: AbortSignal,
) {
  return oxenFetch<CompareDirTreeResponse>(
    `${repoBase(namespace, repo)}/compare/dir_tree/${baseHead(base, head)}`,
    { signal },
  )
}

export function checkMergeable(
  namespace: string,
  repo: string,
  base: string,
  head: string,
  signal?: AbortSignal,
) {
  return oxenFetch<MergeableResponse>(
    `${repoBase(namespace, repo)}/merge/${baseHead(base, head)}`,
    { signal },
  )
}

export function mergeBranches(
  namespace: string,
  repo: string,
  base: string,
  head: string,
  signal?: AbortSignal,
) {
  const author = authorFields()
  return oxenFetch<MergeSuccessResponse>(
    `${repoBase(namespace, repo)}/merge/${baseHead(base, head)}`,
    {
      method: 'POST',
      body: { name: author.name, email: author.email },
      signal,
    },
  )
}

export function listWorkspaces(
  namespace: string,
  repo: string,
  signal?: AbortSignal,
) {
  return oxenFetch<ListWorkspacesResponse>(
    `${repoBase(namespace, repo)}/workspaces`,
    { signal },
  )
}

export function getWorkspace(
  namespace: string,
  repo: string,
  workspaceId: string,
  signal?: AbortSignal,
) {
  return oxenFetch<WorkspaceResponse>(
    `${repoBase(namespace, repo)}/workspaces/${encodeURIComponent(workspaceId)}`,
    { signal },
  )
}

/** Live oxen-server: POST /workspaces (OpenAPI lists PUT …/get_or_create). */
export function createWorkspace(
  namespace: string,
  repo: string,
  branchName: string,
  name: string,
  signal?: AbortSignal,
) {
  const workspaceId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return oxenFetch<WorkspaceResponse>(
    `${repoBase(namespace, repo)}/workspaces`,
    {
      method: 'POST',
      body: {
        workspace_id: workspaceId,
        branch_name: branchName,
        name: name || undefined,
      },
      signal,
    },
  )
}

export function deleteWorkspace(
  namespace: string,
  repo: string,
  workspaceId: string,
  signal?: AbortSignal,
) {
  return oxenFetch<WorkspaceResponse>(
    `${repoBase(namespace, repo)}/workspaces/${encodeURIComponent(workspaceId)}`,
    { method: 'DELETE', signal },
  )
}

/**
 * Remove every workspace in the repo.
 * Live oxen-server 0.61.1 has no bulk `/workspaces/clear` (that path is treated
 * as workspace id "clear" → 404), so we list and delete one-by-one.
 */
export async function clearWorkspaces(
  namespace: string,
  repo: string,
  signal?: AbortSignal,
): Promise<StatusMessage> {
  const listed = await listWorkspaces(namespace, repo, signal)
  for (const ws of listed.workspaces) {
    await deleteWorkspace(namespace, repo, ws.id, signal)
  }
  return {
    status: 'success',
    status_message: 'resource_deleted',
  }
}

export function listWorkspaceChanges(
  namespace: string,
  repo: string,
  workspaceId: string,
  signal?: AbortSignal,
  path?: string,
) {
  const suffix = path
    ?.split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/')
  const pathPart = suffix
    ? `/${suffix}`
    : path?.trim() === '.'
      ? '/.'
      : ''
  return oxenFetch<RemoteStagedStatusResponse>(
    `${repoBase(namespace, repo)}/workspaces/${encodeURIComponent(workspaceId)}/changes${pathPart}`,
    { signal },
  )
}

/** Download / preview a staged (or workspace-visible) file. */
export async function downloadWorkspaceFile(
  namespace: string,
  repo: string,
  workspaceId: string,
  path: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const encoded = path
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/')
  const res = await oxenFetch<Response>(
    `${repoBase(namespace, repo)}/workspaces/${encodeURIComponent(workspaceId)}/files/${encoded}`,
    { raw: true, signal },
  )
  return res.blob()
}

export async function downloadWorkspaceFileText(
  namespace: string,
  repo: string,
  workspaceId: string,
  path: string,
  signal?: AbortSignal,
): Promise<string> {
  const blob = await downloadWorkspaceFile(
    namespace,
    repo,
    workspaceId,
    path,
    signal,
  )
  return blob.text()
}

export function unstageWorkspaceFiles(
  namespace: string,
  repo: string,
  workspaceId: string,
  paths: string[],
  signal?: AbortSignal,
) {
  return oxenFetch<StatusMessage>(
    `${repoBase(namespace, repo)}/workspaces/${encodeURIComponent(workspaceId)}/changes`,
    { method: 'DELETE', body: paths, signal },
  )
}

/** Upload into a workspace directory; filename comes from the File. */
export function uploadToWorkspace(
  namespace: string,
  repo: string,
  workspaceId: string,
  directory: string,
  file: File,
  signal?: AbortSignal,
) {
  const dir = directory
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/')
  const form = new FormData()
  form.append('file', file, file.name)
  // Live oxen-server requires a trailing slash for repo-root uploads (`/files/`).
  const suffix = dir ? `/${dir}` : '/'
  return oxenFetch<StatusMessage & { paths?: string[] }>(
    `${repoBase(namespace, repo)}/workspaces/${encodeURIComponent(workspaceId)}/files${suffix}`,
    { method: 'POST', formData: form, signal },
  )
}

export function stageWorkspaceRemovals(
  namespace: string,
  repo: string,
  workspaceId: string,
  paths: string[],
  signal?: AbortSignal,
) {
  return oxenFetch<StatusMessage & { paths?: string[] }>(
    `${repoBase(namespace, repo)}/workspaces/${encodeURIComponent(workspaceId)}/files`,
    { method: 'DELETE', body: paths, signal },
  )
}

export function checkWorkspaceMergeable(
  namespace: string,
  repo: string,
  workspaceId: string,
  branch: string,
  signal?: AbortSignal,
) {
  return oxenFetch<MergeableResponse>(
    `${repoBase(namespace, repo)}/workspaces/${encodeURIComponent(workspaceId)}/merge/${encodeURIComponent(branch)}`,
    { signal },
  )
}

export function mergeWorkspace(
  namespace: string,
  repo: string,
  workspaceId: string,
  branch: string,
  message: string,
  signal?: AbortSignal,
) {
  const author = authorFields()
  return oxenFetch<CommitResponse>(
    `${repoBase(namespace, repo)}/workspaces/${encodeURIComponent(workspaceId)}/merge/${encodeURIComponent(branch)}`,
    {
      method: 'POST',
      body: {
        message,
        author: author.name,
        email: author.email,
      },
      signal,
    },
  )
}

export function getDataFrameSlice(
  namespace: string,
  repo: string,
  branch: string,
  path: string,
  opts: { page?: number; pageSize?: number } = {},
  signal?: AbortSignal,
) {
  const resource = resourcePath(branch, path)
  const qs = new URLSearchParams()
  if (opts.page) qs.set('page', String(opts.page))
  if (opts.pageSize) qs.set('page_size', String(opts.pageSize))
  const query = qs.toString()
  return oxenFetch<DataFrameSliceResponse>(
    `${repoBase(namespace, repo)}/data_frames/${resource}${query ? `?${query}` : ''}`,
    { signal },
  )
}

/** Live oxen-server: POST /data_frames/index/{resource} */
export function indexDataFrame(
  namespace: string,
  repo: string,
  branch: string,
  path: string,
  signal?: AbortSignal,
) {
  const resource = resourcePath(branch, path)
  return oxenFetch<StatusMessage>(
    `${repoBase(namespace, repo)}/data_frames/index/${resource}`,
    { method: 'POST', signal },
  )
}

export async function exportZip(
  namespace: string,
  repo: string,
  branch: string,
  path = '',
  signal?: AbortSignal,
): Promise<Blob> {
  const resource = resourcePath(branch, path)
  const res = await oxenFetch<Response>(
    `${repoBase(namespace, repo)}/export/download/${resource}`,
    { signal, raw: true },
  )
  return res.blob()
}

export function importFromUrl(
  namespace: string,
  repo: string,
  branch: string,
  destPath: string,
  downloadUrl: string,
  message: string,
  opts: { filename?: string; auth?: string } = {},
  signal?: AbortSignal,
) {
  const resource = resourcePath(branch, destPath)
  const author = authorFields()
  return oxenFetch<CommitResponse>(
    `${repoBase(namespace, repo)}/import/${resource}`,
    {
      method: 'POST',
      body: {
        download_url: downloadUrl,
        message,
        name: author.name,
        email: author.email,
        filename: opts.filename,
        auth: opts.auth,
      },
      signal,
    },
  )
}

export function uploadZipArchive(
  namespace: string,
  repo: string,
  branch: string,
  destDir: string,
  file: File,
  commitMessage: string,
  signal?: AbortSignal,
) {
  const resource = resourcePath(branch, destDir)
  const author = authorFields()
  const form = new FormData()
  form.append('file', file, file.name)
  form.append('commit_message', commitMessage)
  form.append('name', author.name)
  form.append('email', author.email)
  return oxenFetch<CommitResponse>(
    `${repoBase(namespace, repo)}/import/upload/${resource}`,
    { method: 'POST', formData: form, signal },
  )
}

/**
 * File version history for a path. Oxen's `/branches/{name}/versions/…` only
 * accepts branch names; when `revision` is a commit hash (or the branch call
 * 404s), fall back to path-scoped commit history.
 */
export async function listFileVersions(
  namespace: string,
  repo: string,
  revision: string,
  path: string,
  signal?: AbortSignal,
): Promise<PaginatedEntryVersionsResponse> {
  const encodedPath = path
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/')

  async function fromCommitHistory(): Promise<PaginatedEntryVersionsResponse> {
    const hist = await listCommitHistory(
      namespace,
      repo,
      revision,
      signal,
      path,
    )
    return {
      status: hist.status,
      status_message: hist.status_message,
      versions: hist.commits.map((commit) => ({
        commit,
        resource: { path, version: commit.id },
      })),
      page_number: hist.page_number,
      page_size: hist.page_size,
      total_pages: hist.total_pages,
      total_entries: hist.total_entries,
      branch: { name: revision, commit_id: revision },
      path,
    }
  }

  if (looksLikeCommitId(revision)) {
    return fromCommitHistory()
  }

  try {
    return await oxenFetch<PaginatedEntryVersionsResponse>(
      `${repoBase(namespace, repo)}/branches/${encodeURIComponent(revision)}/versions/${encodedPath}`,
      { signal },
    )
  } catch (err) {
    if (err instanceof OxenApiError && (err.status === 404 || err.status === 400)) {
      return fromCommitHistory()
    }
    throw err
  }
}

export function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function getVersionFileMetadata(
  namespace: string,
  repo: string,
  hash: string,
  signal?: AbortSignal,
) {
  return oxenFetch<VersionFileResponse>(
    `${repoBase(namespace, repo)}/versions/${encodeURIComponent(hash)}/metadata`,
    { signal },
  )
}

/**
 * Batch download by content hashes.
 * Live: QUERY /versions with gzip line-delimited hashes (OpenAPI POST …/batch-download 404s).
 * Returns the raw gzipped tarball from the server.
 */
export async function downloadVersionsTarball(
  namespace: string,
  repo: string,
  hashes: string[],
  signal?: AbortSignal,
): Promise<Blob> {
  const cleaned = hashes.map((h) => h.trim()).filter(Boolean)
  if (cleaned.length === 0) throw new Error('At least one hash is required')
  const payload = new TextEncoder().encode(cleaned.join('\n') + '\n')
  const stream = new Blob([payload])
    .stream()
    .pipeThrough(new CompressionStream('gzip'))
  const gzipBody = await new Response(stream).arrayBuffer()

  const res = await oxenFetch<Response>(
    `${repoBase(namespace, repo)}/versions`,
    {
      method: 'QUERY',
      binaryBody: gzipBody,
      contentType: 'application/gzip',
      accept: 'application/gzip',
      raw: true,
      signal,
    },
  )
  return res.blob()
}

/** Download a single blob by content hash via QUERY /versions (extracts tar member). */
export async function downloadVersionByHash(
  namespace: string,
  repo: string,
  hash: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const tarball = await downloadVersionsTarball(
    namespace,
    repo,
    [hash],
    signal,
  )
  const members = await extractGzipTar(await tarball.arrayBuffer())
  const data = members.get(hash) ?? members.values().next().value
  if (!data) {
    throw new Error(`Hash ${hash} not found in version store tarball`)
  }
  const copy = new Uint8Array(data.byteLength)
  copy.set(data)
  return new Blob([copy])
}

/** Download via version store resource path: GET …/versions/{revision}/{path} */
export async function downloadVersionResource(
  namespace: string,
  repo: string,
  revision: string,
  path: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const resource = resourcePath(revision, path)
  const res = await oxenFetch<Response>(
    `${repoBase(namespace, repo)}/versions/${resource}`,
    { raw: true, signal },
  )
  return res.blob()
}

const LARGE_CHUNK = 4 * 1024 * 1024

/** Files at or above this size use the chunked large-upload API. */
export const UPLOAD_LARGE_THRESHOLD = LARGE_CHUNK

export type LargeUploadProgress = {
  phase: 'hash' | 'create' | 'chunks' | 'complete'
  bytesSent: number
  totalBytes: number
  chunksDone: number
  chunksTotal: number
}

/**
 * Create a directory by committing an empty `.oxenkeep` placeholder
 * (oxen-server has no dedicated mkdir endpoint).
 */
export function createFolder(
  namespace: string,
  repo: string,
  branch: string,
  parentPath: string,
  folderName: string,
  message?: string,
  signal?: AbortSignal,
) {
  const name = folderName.trim().replace(/^\/+|\/+$/g, '')
  if (!name || name.includes('/')) {
    return Promise.reject(new Error('Enter a single folder name (no slashes)'))
  }
  const dest = parentPath
    ? `${parentPath.replace(/\/+$/, '')}/${name}/.oxenkeep`
    : `${name}/.oxenkeep`
  const keep = new File([''], '.oxenkeep', { type: 'text/plain' })
  return uploadFile(
    namespace,
    repo,
    branch,
    dest,
    keep,
    message?.trim() || `Create folder ${name}`,
    signal,
  )
}

/**
 * Chunked large-file upload (XXH3-128 version id), optionally staged into a workspace.
 * @see https://docs.oxen.ai/http-api/large-file-upload
 */
export async function uploadLargeFile(
  namespace: string,
  repo: string,
  file: File,
  opts: {
    dstDir?: string
    workspaceId?: string
    onProgress?: (p: LargeUploadProgress) => void
    signal?: AbortSignal
  } = {},
): Promise<{ versionId: string; numChunks: number }> {
  const { dstDir = '', workspaceId, onProgress, signal } = opts
  onProgress?.({
    phase: 'hash',
    bytesSent: 0,
    totalBytes: file.size,
    chunksDone: 0,
    chunksTotal: 0,
  })
  const versionId = await xxh128File(file)
  const chunksTotal = Math.max(1, Math.ceil(file.size / LARGE_CHUNK))

  onProgress?.({
    phase: 'create',
    bytesSent: 0,
    totalBytes: file.size,
    chunksDone: 0,
    chunksTotal,
  })
  await oxenFetch<StatusMessage>(
    `${repoBase(namespace, repo)}/versions/${encodeURIComponent(versionId)}/create`,
    {
      method: 'POST',
      body: {
        hash: versionId,
        file_name: file.name,
        size: file.size,
        dst_dir: dstDir || undefined,
      },
      signal,
    },
  )

  let offset = 0
  let chunksDone = 0
  while (offset < file.size) {
    const end = Math.min(offset + LARGE_CHUNK, file.size)
    const chunk = file.slice(offset, end)
    const bytes = new Uint8Array(await chunk.arrayBuffer())
    const { apiBase } = loadSettings()
    const headers: Record<string, string> = {
      'Content-Type': 'application/octet-stream',
    }
    const url = `${apiBase}${repoBase(namespace, repo)}/versions/${encodeURIComponent(versionId)}/chunks?offset=${offset}`
    const res = await fetch(url, {
      method: 'PUT',
      headers,
      body: bytes,
      signal,
      credentials: 'same-origin',
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(text || `Chunk upload failed (${res.status})`)
    }
    offset = end
    chunksDone += 1
    onProgress?.({
      phase: 'chunks',
      bytesSent: offset,
      totalBytes: file.size,
      chunksDone,
      chunksTotal,
    })
  }

  onProgress?.({
    phase: 'complete',
    bytesSent: file.size,
    totalBytes: file.size,
    chunksDone,
    chunksTotal,
  })
  await oxenFetch<StatusMessage>(
    `${repoBase(namespace, repo)}/versions/${encodeURIComponent(versionId)}/complete`,
    {
      method: 'POST',
      body: {
        files: [
          {
            hash: versionId,
            file_name: file.name,
            dst_dir: dstDir || undefined,
            num_chunks: chunksDone,
          },
        ],
        workspace_id: workspaceId,
      },
      signal,
    },
  )

  return { versionId, numChunks: chunksDone }
}

export function createDataFrameCompare(
  namespace: string,
  repo: string,
  body: TabularCompareBody,
  signal?: AbortSignal,
) {
  return oxenFetch<DataFrameCompareResult>(
    `${repoBase(namespace, repo)}/compare/data_frames`,
    { method: 'POST', body, signal },
  )
}

/**
 * Update / refresh a cached tabular compare.
 * Live: PUT …/compare/data_frames/{id} (GET by id 404; POST …/{id} 400 on 0.61.1).
 */
export function updateDataFrameCompare(
  namespace: string,
  repo: string,
  compareId: string,
  body: TabularCompareBody,
  signal?: AbortSignal,
) {
  return oxenFetch<DataFrameCompareResult>(
    `${repoBase(namespace, repo)}/compare/data_frames/${encodeURIComponent(compareId)}`,
    {
      method: 'PUT',
      body: { ...body, compare_id: compareId },
      signal,
    },
  )
}

export function deleteDataFrameCompare(
  namespace: string,
  repo: string,
  compareId: string,
  signal?: AbortSignal,
) {
  return oxenFetch<StatusMessage>(
    `${repoBase(namespace, repo)}/compare/data_frames/${encodeURIComponent(compareId)}`,
    { method: 'DELETE', signal },
  )
}

/**
 * Browse derived DF diff rows.
 * Live path: GET …/compare/data_frames/{id}/{path}/{left}..{right}
 * (GET …/{id} and …/{id}/diff 404 on 0.61.1)
 */
export function getDataFrameCompareDiff(
  namespace: string,
  repo: string,
  compareId: string,
  path: string,
  leftVersion: string,
  rightVersion: string,
  opts: { page?: number; pageSize?: number } = {},
  signal?: AbortSignal,
) {
  const encoded = path
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/')
  const qs = new URLSearchParams()
  if (opts.page) qs.set('page', String(opts.page))
  if (opts.pageSize) qs.set('page_size', String(opts.pageSize))
  const query = qs.toString()
  return oxenFetch<DataFrameSliceResponse>(
    `${repoBase(namespace, repo)}/compare/data_frames/${encodeURIComponent(compareId)}/${encoded}/${baseHead(leftVersion, rightVersion)}${query ? `?${query}` : ''}`,
    { signal },
  )
}

export function createDataFrameFromDirectory(
  namespace: string,
  repo: string,
  branch: string,
  directory: string,
  opts: {
    outputPath: string
    commitMessage: string
    recursive?: boolean
  },
  signal?: AbortSignal,
) {
  const resource = resourcePath(branch, directory)
  const author = authorFields()
  return oxenFetch<CommitResponse>(
    `${repoBase(namespace, repo)}/data_frames/from_directory/${resource}`,
    {
      method: 'POST',
      body: {
        output_path: opts.outputPath,
        commit_message: opts.commitMessage,
        recursive: opts.recursive ?? true,
        user_name: author.name,
        user_email: author.email,
      },
      signal,
    },
  )
}

export function setWorkspaceDataFrameSchemaMetadata(
  namespace: string,
  repo: string,
  workspaceId: string,
  path: string,
  metadata: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const encoded = path
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/')
  return oxenFetch<StatusMessage>(
    `${repoBase(namespace, repo)}/workspaces/${encodeURIComponent(workspaceId)}/data_frames/schema/${encoded}`,
    { method: 'PUT', body: { metadata }, signal },
  )
}

export function setWorkspaceColumnSchemaMetadata(
  namespace: string,
  repo: string,
  workspaceId: string,
  path: string,
  columnName: string,
  metadata: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const encoded = path
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/')
  return oxenFetch<StatusMessage>(
    `${repoBase(namespace, repo)}/workspaces/${encodeURIComponent(workspaceId)}/data_frames/columns/schema/metadata/${encoded}`,
    {
      method: 'POST',
      body: { column_name: columnName, metadata },
      signal,
    },
  )
}
