export type StatusMessage = {
  status: string
  status_message: string
  oxen_version?: string | null
  status_description?: string
  error?: { title?: string; detail?: string; type?: string }
}

export type OxenVersionResponse = StatusMessage & {
  oxen_version: string
}

export type NamespaceView = { namespace: string }

export type Namespace = {
  name: string
  storage_usage_gb: number
}

export type ListNamespacesResponse = StatusMessage & {
  namespaces: NamespaceView[]
}

export type NamespaceResponse = StatusMessage & {
  namespace: Namespace
}

export type RepositoryListView = {
  namespace: string
  name: string
  min_version?: string | null
}

export type ListRepositoryResponse = StatusMessage & {
  repositories: RepositoryListView[]
}

export type DataTypeCount = {
  data_type: string
  count: number
}

export type RepositoryDataTypesView = {
  namespace: string
  name: string
  is_empty: boolean
  storage_kind: string
  size: number
  data_types: DataTypeCount[]
  branch_count?: number
  min_version?: string | null
  repo_uuid?: string | null
}

export type RepositoryDataTypesResponse = StatusMessage & {
  repository: RepositoryDataTypesView
}

export type RepositoryCreationView = {
  namespace: string
  name: string
  latest_commit?: unknown
  min_version?: string | null
  storage_kind?: string
  repo_uuid?: string | null
}

export type RepositoryCreationResponse = StatusMessage & {
  repository: RepositoryCreationView
}

export type DataTypeView = {
  data_type: string
  data_size: number
  file_count: number
}

export type RepositoryStatsView = {
  data_size: number
  data_types: DataTypeView[]
}

export type RepositoryStatsResponse = StatusMessage & {
  repository: RepositoryStatsView
}

export type RepoSizeFile = {
  status: 'pending' | 'done' | 'error'
  size: number
}

export type CreateRepoInput = {
  namespace: string
  name: string
  description?: string
}

export type Commit = {
  id: string
  parent_ids: string[]
  message: string
  author: string
  email: string
  timestamp: string
}

export type Branch = {
  name: string
  commit_id: string
}

export type ListBranchesResponse = StatusMessage & {
  branches: Branch[]
}

export type BranchResponse = StatusMessage & {
  branch: Branch
}

export type CommitResponse = StatusMessage & {
  commit: Commit
}

export type MetadataEntry = {
  filename: string
  hash: string
  is_dir: boolean
  size: number
  data_type: string
  mime_type: string
  extension: string
  is_queryable?: boolean | null
  latest_commit?: Commit | null
  metadata?: unknown
  resource?: {
    path?: string
    version?: string
    resource?: string
  }
}

export type PaginatedDirEntriesResponse = StatusMessage & {
  dir?: MetadataEntry | null
  entries: MetadataEntry[]
  page_number: number
  page_size: number
  total_pages: number
  total_entries: number
  resource?: { path?: string; version?: string } | null
}

export type MetadataEntryResponse = StatusMessage & {
  entry: MetadataEntry
}

export type ListCommitsResponse = StatusMessage & {
  commits: Commit[]
  page_number?: number
  page_size?: number
  total_pages?: number
  total_entries?: number
}

export type DiffEntryStatus = 'added' | 'modified' | 'removed'

export type LineDiff = {
  modification: string
  text: string
}

export type TextDiff = {
  lines: LineDiff[]
  filename1?: string | null
  filename2?: string | null
}

export type DiffEntry = {
  filename: string
  status: DiffEntryStatus
  data_type?: string
  is_dir?: boolean
  size?: number
  diff?: TextDiff | null
  diff_summary?: unknown
  head_entry?: MetadataEntry | null
  base_entry?: MetadataEntry | null
}

export type AddRemoveModifyCounts = {
  added: number
  removed: number
  modified: number
}

export type CompareEntries = {
  base_commit: Commit
  head_commit: Commit
  counts: AddRemoveModifyCounts
  entries: DiffEntry[]
  self?: DiffEntry | null
}

export type CompareEntriesResponse = StatusMessage & {
  compare: CompareEntries
  page_number?: number
  page_size?: number
  total_pages?: number
  total_entries?: number
}

export type CompareCommit = Commit & {
  // Some servers tag which side a commit belongs to in three-dot compares.
  side?: string
}

export type CompareCommits = {
  base_commit: Commit
  head_commit: Commit
  commits: CompareCommit[]
}

export type CompareCommitsResponse = StatusMessage & {
  compare: CompareCommits
  page_number?: number
  page_size?: number
  total_pages?: number
  total_entries?: number
}

export type CompareEntryResponse = StatusMessage & {
  compare: DiffEntry
}

export type CompareDirNode = {
  name: string
  status: string
  num_subdirs?: number
  can_display?: boolean
  children?: CompareDirNode[]
}

export type CompareDirTreeResponse = StatusMessage & {
  dirs: CompareDirNode[]
}

export type MergeConflictFile = {
  path?: string
  [key: string]: unknown
}

export type MergeableResponse = StatusMessage & {
  is_mergeable: boolean
  conflicts: MergeConflictFile[]
  commits: Commit[]
}

export type MergeSuccessResponse = StatusMessage & {
  commits: {
    base: Commit
    head: Commit
    merge: Commit
  }
}

export type Workspace = {
  id: string
  name?: string | null
  commit: Commit
  created_at?: string | null
}

export type ListWorkspacesResponse = StatusMessage & {
  workspaces: Workspace[]
}

export type WorkspaceResponse = StatusMessage & {
  workspace: Workspace
}

export type PaginatedDirEntries = {
  entries: MetadataEntry[]
  page_number?: number
  page_size?: number
  total_pages?: number
  total_entries?: number
}

export type RemoteStagedStatus = {
  added_dirs: {
    num_files_staged: number
    total_files: number
    paths: Record<string, { path: string; num_files_staged: number; status: string }[]>
  }
  added_files: PaginatedDirEntries
  modified_files: PaginatedDirEntries
  removed_files: PaginatedDirEntries
}

export type RemoteStagedStatusResponse = StatusMessage & {
  staged: RemoteStagedStatus
}

export type DataFrameField = {
  name: string
  dtype: string
  metadata?: unknown
}

export type DataFrameView = {
  schema: { hash?: string; fields: DataFrameField[] }
  size: { height: number; width: number }
  data: Record<string, unknown>[]
  pagination: {
    page_size: number
    page_number: number
    total_pages: number
    total_entries: number
  }
}

export type DataFrameSlice = {
  source: { schema: { fields: DataFrameField[] }; size: { height: number; width: number } }
  view: DataFrameView
  commit?: Commit
  resource?: { path?: string; version?: string }
}

export type DataFrameSliceResponse = StatusMessage & {
  data_frame: DataFrameSlice
}

export type CommitEntryVersion = {
  commit: Commit
  resource: { path: string; version: string }
  schema_hash?: string | null
}

export type PaginatedEntryVersionsResponse = StatusMessage & {
  versions: CommitEntryVersion[]
  page_number?: number
  page_size?: number
  total_pages?: number
  total_entries?: number
  branch: Branch
  path: string
}

export type VersionFile = {
  hash: string
  size: number
}

export type VersionFileResponse = StatusMessage & {
  version: VersionFile
}

export type TabularCompareResource = {
  path: string
  version: string
}

export type TabularCompareField = {
  left: string
  right: string
  alias_as?: string | null
  compare_method?: string | null
}

export type TabularCompareTarget = {
  left?: string | null
  right?: string | null
  compare_method?: string | null
}

export type TabularCompareBody = {
  compare_id: string
  left: TabularCompareResource
  right: TabularCompareResource
  keys: TabularCompareField[]
  compare: TabularCompareTarget[]
  display: TabularCompareTarget[]
}

export type DataFrameCompareResult = StatusMessage & {
  dfs: {
    summary?: {
      modifications?: {
        added_rows?: number
        removed_rows?: number
        modified_rows?: number
      }
    }
    schema_diff?: {
      added_cols?: unknown[]
      removed_cols?: unknown[]
    }
    keys?: TabularCompareField[]
    targets?: TabularCompareTarget[]
    display?: TabularCompareTarget[]
    dupes?: { left?: number; right?: number }
    [key: string]: unknown
  }
  messages?: { level?: string; title?: string; description?: string }[]
}

export class OxenApiError extends Error {
  status: number
  body: StatusMessage | null

  constructor(message: string, status: number, body: StatusMessage | null) {
    super(message)
    this.name = 'OxenApiError'
    this.status = status
    this.body = body
  }
}
