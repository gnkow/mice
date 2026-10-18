export type JobStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

export type JobPathRef = { path: string; hash: string }

export type JobRun = {
  id: string
  /** Optional display name (empty = show id only). */
  name: string
  status: JobStatus
  namespace: string
  repo: string
  /** Resolved pin as `branch:commit`. */
  source_ref: string
  pin_commit: string
  /** @deprecated Legacy server merge destination. Prefer sync_branch. */
  target_branch: string
  /** Branch that was pushed when this job was published to the BFF. */
  sync_branch?: string
  result_commit: string | null
  /** Branch that received the result commit (CLI: source branch). */
  result_branch: string | null
  image: string
  image_digest: string | null
  command: string[]
  args: string[]
  env: Record<string, string>
  workdir: string
  input_globs: string[]
  timeout_seconds: number
  resources: { cpu: string; memory: string; disk: string }
  max_log_bytes: number
  network: string
  actor: { sub: string; iss: string; email: string; name: string }
  via: 'session' | 'pat'
  inputs: JobPathRef[]
  outputs: JobPathRef[]
  created_at: string
  started_at: string | null
  finished_at: string | null
  exit_code: number | null
  error: string | null
  log_ref: string | null
  source: 'commit_clone' | 'workspace_mount'
  workspace_id: string | null
  runner: 'docker' | 'kubernetes' | 'cli'
  /** @deprecated */
  branch?: string
}

/** Where the job executes: local CLI machine vs server (Docker/K8s). */
export type JobRunnerKind = 'local' | 'cluster'

export function jobRunnerKind(
  job: Pick<JobRun, 'runner'> | { runner?: string | null },
): JobRunnerKind {
  return job.runner === 'cli' ? 'local' : 'cluster'
}

export function jobRunnerDetail(
  job: Pick<JobRun, 'runner'> | { runner?: string | null },
): string {
  if (job.runner === 'cli') return 'Local (CLI)'
  if (job.runner === 'kubernetes') return 'Cluster (Kubernetes)'
  return 'Cluster (Docker)'
}

/** Short badge text: Local | Cluster */
export function jobRunnerLabel(
  job: Pick<JobRun, 'runner'> | { runner?: string | null },
): string {
  return jobRunnerKind(job) === 'cluster' ? 'Cluster' : 'Local'
}

export function jobRunnerClass(
  job: Pick<JobRun, 'runner'> | { runner?: string | null },
): string {
  return jobRunnerKind(job) === 'cluster'
    ? 'pill runner-cluster'
    : 'pill runner-local'
}

/** Display helper: prefer server `source_ref`, else synthesize. */
export function jobSourceLabel(job: JobRun): string {
  if (job.source_ref) return job.source_ref
  const target = job.target_branch || job.branch || ''
  if (target && job.pin_commit) return `${target}:${job.pin_commit}`
  return job.pin_commit || target || '—'
}

export function jobTargetLabel(job: JobRun): string {
  const sync = (job.sync_branch || '').trim()
  if (sync) return sync
  const t = (job.target_branch || '').trim()
  return t || '—'
}

export function jobResultBranchLabel(job: JobRun): string {
  return job.result_branch?.trim() || '—'
}

function shortCommit(id: string | null | undefined, n = 12): string {
  const s = (id || '').trim()
  if (!s) return ''
  return s.length > n ? s.slice(0, n) : s
}

/** Shorten `branch:longhash` (or bare hash) for list UI. */
export function shortenJobRef(ref: string, commitLen = 8): string {
  const s = ref.trim()
  if (!s || s === '—' || s === 'local') return s
  const i = s.indexOf(':')
  if (i === -1) return shortCommit(s, commitLen) || s
  const left = s.slice(0, i)
  const right = s.slice(i + 1)
  const short = shortCommit(right, commitLen)
  return short ? `${left}:${short}` : left
}

/**
 * Where the job landed: synced branch, result branch, or local-only commit.
 */
export function jobOutcomeRefLabel(job: JobRun): string {
  const commit = shortCommit(job.result_commit)
  const syncTo = (job.sync_branch || '').trim()
  if (syncTo) {
    return commit ? `${syncTo}:${commit}` : syncTo
  }
  const legacyMerge = (job.target_branch || '').trim()
  if (legacyMerge) {
    return commit ? `${legacyMerge}:${commit}` : legacyMerge
  }
  const branch = (job.result_branch || '').trim()
  if (branch) {
    return commit ? `${branch}:${commit}` : branch
  }
  return commit || 'local'
}

/** Image tag for list rows (truncated). */
export function jobImageLabel(job: Pick<JobRun, 'image'>, max = 40): string {
  const img = (job.image || '').trim()
  if (!img) return ''
  if (img.length <= max) return img
  return `…${img.slice(-(max - 1))}`
}

/** Command + args joined for list rows (truncated). */
export function jobCommandLabel(
  job: Pick<JobRun, 'command' | 'args'>,
  max = 64,
): string {
  const parts = [...(job.command ?? []), ...(job.args ?? [])]
  const s = parts.join(' ').trim()
  if (!s) return ''
  if (s.length <= max) return s
  return `${s.slice(0, Math.max(0, max - 1))}…`
}

export const JOB_STATUSES: JobStatus[] = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]

export type JobListSort =
  | 'created_desc'
  | 'created_asc'
  | 'finished_desc'
  | 'finished_asc'
  | 'name_asc'
  | 'status_asc'

export const JOB_LIST_SORTS: { value: JobListSort; label: string }[] = [
  { value: 'created_desc', label: 'Newest first' },
  { value: 'created_asc', label: 'Oldest first' },
  { value: 'finished_desc', label: 'Finished (newest)' },
  { value: 'finished_asc', label: 'Finished (oldest)' },
  { value: 'name_asc', label: 'Name' },
  { value: 'status_asc', label: 'Status' },
]

export type JobListFilters = {
  status?: JobStatus | ''
  runner?: JobRunnerKind | ''
  /** Exact match on source pin branch (`source_ref` left of `:`). */
  source_branch?: string
  /** Exact match on publish/sync target (`sync_branch` or legacy `target_branch`). */
  target_branch?: string
  q?: string
  sort?: JobListSort | ''
}

/** Branch name from `branch:commit` source pin. */
export function jobSourceBranch(job: JobRun): string {
  const ref = (job.source_ref || jobSourceLabel(job)).trim()
  const colon = ref.indexOf(':')
  if (colon > 0) return ref.slice(0, colon).trim()
  return ''
}

/**
 * Branch the job was published / synced to (CLI push), else legacy merge target.
 */
export function jobTargetBranch(job: JobRun): string {
  const sync = (job.sync_branch || '').trim()
  if (sync) return sync
  return (job.target_branch || '').trim()
}

/** Unique source/target branch names present in a job list (sorted). */
export function collectJobBranches(jobs: JobRun[]): {
  source: string[]
  target: string[]
} {
  const source = new Set<string>()
  const target = new Set<string>()
  for (const j of jobs) {
    const s = jobSourceBranch(j)
    const t = jobTargetBranch(j)
    if (s) source.add(s)
    if (t) target.add(t)
  }
  const byName = (a: string, b: string) => a.localeCompare(b)
  return {
    source: [...source].sort(byName),
    target: [...target].sort(byName),
  }
}

export function parseJobStatus(raw: string | null | undefined): JobStatus | '' {
  const s = (raw || '').trim()
  return (JOB_STATUSES as string[]).includes(s) ? (s as JobStatus) : ''
}

export function parseJobRunner(
  raw: string | null | undefined,
): JobRunnerKind | '' {
  const s = (raw || '').trim()
  return s === 'local' || s === 'cluster' ? s : ''
}

export function parseJobListSort(
  raw: string | null | undefined,
): JobListSort {
  const s = (raw || '').trim()
  return JOB_LIST_SORTS.some((o) => o.value === s)
    ? (s as JobListSort)
    : 'created_desc'
}

const STATUS_ORDER: Record<JobStatus, number> = {
  running: 0,
  queued: 1,
  failed: 2,
  cancelled: 3,
  succeeded: 4,
}

function jobSearchBlob(job: JobRun): string {
  return [
    job.name,
    job.id,
    job.status,
    job.image,
    jobRunnerLabel(job),
    job.actor?.name,
    job.actor?.email,
    ...(job.command ?? []),
    ...(job.args ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

/** Client-side filter + sort for repository (and global) job lists. */
export function filterAndSortJobs(
  jobs: JobRun[],
  filters: JobListFilters = {},
): JobRun[] {
  const status = filters.status || ''
  const runner = filters.runner || ''
  const sourceBranch = (filters.source_branch || '').trim()
  const targetBranch = (filters.target_branch || '').trim()
  const q = (filters.q || '').trim().toLowerCase()
  const sort = parseJobListSort(filters.sort)

  let out = jobs
  if (status) out = out.filter((j) => j.status === status)
  if (runner) out = out.filter((j) => jobRunnerKind(j) === runner)
  if (sourceBranch) {
    out = out.filter((j) => jobSourceBranch(j) === sourceBranch)
  }
  if (targetBranch) {
    out = out.filter((j) => jobTargetBranch(j) === targetBranch)
  }
  if (q) out = out.filter((j) => jobSearchBlob(j).includes(q))

  const sorted = [...out]
  sorted.sort((a, b) => {
    switch (sort) {
      case 'created_asc':
        return a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
      case 'finished_desc': {
        const af = a.finished_at || ''
        const bf = b.finished_at || ''
        if (af !== bf) return bf.localeCompare(af)
        return b.created_at.localeCompare(a.created_at)
      }
      case 'finished_asc': {
        const af = a.finished_at || '\uffff'
        const bf = b.finished_at || '\uffff'
        if (af !== bf) return af.localeCompare(bf)
        return a.created_at.localeCompare(b.created_at)
      }
      case 'name_asc': {
        const an = (a.name || a.id).toLowerCase()
        const bn = (b.name || b.id).toLowerCase()
        return an.localeCompare(bn) || a.id.localeCompare(b.id)
      }
      case 'status_asc': {
        const d = STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
        if (d !== 0) return d
        return b.created_at.localeCompare(a.created_at)
      }
      case 'created_desc':
      default:
        return b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id)
    }
  })
  return sorted
}

async function jobsFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) detail = body.error
    } catch {
      /* ignore */
    }
    throw new Error(detail || `HTTP ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('application/json')) return (await res.json()) as T
  return (await res.text()) as T
}

export function listJobs(
  opts?: {
    namespace?: string
    repo?: string
    status?: JobStatus
    limit?: number
    cursor?: string
  },
  signal?: AbortSignal,
) {
  const params = new URLSearchParams()
  if (opts?.namespace) params.set('namespace', opts.namespace)
  if (opts?.repo) params.set('repo', opts.repo)
  if (opts?.status) params.set('status', opts.status)
  if (opts?.limit != null) params.set('limit', String(opts.limit))
  if (opts?.cursor) params.set('cursor', opts.cursor)
  const qs = params.toString()
  return jobsFetch<{ jobs: JobRun[]; nextCursor: string | null }>(
    `/auth/jobs${qs ? `?${qs}` : ''}`,
    { signal },
  )
}

export function getJob(id: string, signal?: AbortSignal) {
  return jobsFetch<{ job: JobRun }>(`/auth/jobs/${encodeURIComponent(id)}`, {
    signal,
  })
}

export function cancelJob(id: string, signal?: AbortSignal) {
  return jobsFetch<{ job: JobRun }>(
    `/auth/jobs/${encodeURIComponent(id)}/cancel`,
    { method: 'POST', signal },
  )
}

export function fetchJobLogs(id: string, signal?: AbortSignal) {
  return jobsFetch<string>(`/auth/jobs/${encodeURIComponent(id)}/logs`, {
    signal,
  })
}
