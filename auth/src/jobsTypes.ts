import type { AuditActor, AuditVia } from './audit.js'

export type JobStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

export type JobSource = 'commit_clone'

export type JobPathRef = {
  path: string
  hash: string
}

export type JobResources = {
  cpu: string
  memory: string
  disk: string
}

export type JobRun = {
  id: string
  /** Optional human label for lists/UI (falls back to id). */
  name: string
  status: JobStatus
  namespace: string
  repo: string
  /** Resolved pin source as `branch:commit`. */
  source_ref: string
  pin_commit: string
  /**
   * @deprecated Legacy server-side merge destination (`--target`).
   * CLI path uses `sync_branch` instead.
   */
  target_branch: string
  /**
   * Branch that was pushed when this CLI job was published to the BFF.
   * Empty = not yet published (local-only).
   */
  sync_branch: string
  result_commit: string | null
  /**
   * Branch that received the result commit. CLI path: source branch.
   * Legacy server path: `mice/job/<id>`.
   */
  result_branch: string | null
  image: string
  image_digest: string | null
  command: string[]
  args: string[]
  env: Record<string, string>
  workdir: string
  input_globs: string[]
  timeout_seconds: number
  resources: JobResources
  max_log_bytes: number
  network: string
  actor: AuditActor
  via: AuditVia
  inputs: JobPathRef[]
  outputs: JobPathRef[]
  created_at: string
  started_at: string | null
  finished_at: string | null
  exit_code: number | null
  error: string | null
  log_ref: string | null
  source: JobSource
  /** Docker/K8s runtime id for cancel */
  runtime_id: string | null
  /** `cli` = executed by local `mice job run` (not auth host Docker/K8s). */
  runner: 'docker' | 'kubernetes' | 'cli'
}

export type JobSubmitBody = {
  namespace: string
  repo: string
  /** Optional display name for the run. */
  name?: string
  /**
   * Source pin: `branch:commit` | `branch` | `commit`.
   * Resolved server-side to source_ref + pin_commit.
   */
  source: string
  /** Server-side merge destination. */
  target?: string
  image: string
  command: string[]
  args?: string[]
  env?: Record<string, string>
  workdir?: string
  input_globs?: string[]
  timeout_seconds?: number
  resources?: Partial<JobResources>
  max_log_bytes?: number
  source_kind?: JobSource
  /**
   * When `cli`, auth records the job but does not execute it — the local
   * `mice` CLI runs Docker and reports completion.
   */
  runner?: 'cli' | 'docker' | 'kubernetes'
}
