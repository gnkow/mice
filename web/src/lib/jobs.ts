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
  /** Branch synced to remote after `boxen job sync` / `run --sync`. */
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

/** Where the job executes: Docker on the auth host vs Kubernetes. */
export type JobRunnerKind = 'local' | 'cluster'

export function jobRunnerKind(
  job: Pick<JobRun, 'runner'> | { runner?: string | null },
): JobRunnerKind {
  return job.runner === 'kubernetes' ? 'cluster' : 'local'
}

export function jobRunnerDetail(
  job: Pick<JobRun, 'runner'> | { runner?: string | null },
): string {
  if (job.runner === 'kubernetes') return 'Cluster (Kubernetes)'
  if (job.runner === 'cli') return 'Local (CLI)'
  return 'Local (Docker)'
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
