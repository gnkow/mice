/** Public entry point for the jobs module. */
export {
  jobSnapshot,
  branchFromSourceRef,
  publicJob,
  parseSubmitBody,
  parseJobCompleteBody,
  parseCliJobPublishItem,
  submitJob,
  appendJobResultCommitIntent,
  completeCliJob,
  publishSyncedCliJobs,
  listJobsPublic,
  getJobPublic,
  readJobLogs,
  cancelJob,
  resumeQueuedJobs,
} from './lib/jobs.js'
export type { JobCompleteBody, CliJobPublishBody } from './lib/jobs.js'

export { listJobsForCaller } from './lib/jobsList.js'
export type { ListJobsRequest } from './lib/jobsList.js'

export type {
  JobStatus,
  JobSource,
  JobPathRef,
  JobResources,
  JobRun,
  JobSubmitBody,
} from './lib/jobsTypes.js'

/** Niche oxen/runner/store helpers stay on root strangler shims (`auth/src/jobs*.ts`). */

export {
  appendJob,
  getJob,
  listJobs,
  rekeyJob,
  resolveJobId,
  upsertJob,
} from './lib/jobsStore.js'
export { parseSourceSpec } from './lib/jobsSource.js'
export { matchGlobs, toDockerHostPath, resolveReadWatchBin } from './lib/jobsRunner.js'
export { mergeRangePath, diffTrees, getBranchTip, listMergeCommits, mergeBranch, materializeCommitClone } from './lib/jobsOxen.js'

