/** Boot wires lookups so workspaces does not import jobs/desktop-sessions. */
import type { JobRun } from '../../jobs/index.js'
import type { DesktopSession } from '../../desktop-sessions/index.js'

export type JobLookup = (id: string) => Promise<JobRun | null | undefined>
export type SessionLookup = (id: string) => Promise<DesktopSession | null | undefined>
export type ListSessions = () => Promise<DesktopSession[]>

let jobLookup: JobLookup | null = null
let sessionLookup: SessionLookup | null = null
let listSessionsFn: ListSessions | null = null

export function initWorkspaces(deps: {
  getJob: JobLookup
  getSessionRecord: SessionLookup
  listSessions: ListSessions
}): void {
  jobLookup = deps.getJob
  sessionLookup = deps.getSessionRecord
  listSessionsFn = deps.listSessions
}

/** @deprecated Use initWorkspaces */
export const wireWorkspaceLookups = initWorkspaces

export async function lookupJob(id: string): Promise<JobRun | null | undefined> {
  if (!jobLookup) throw new Error('workspace job lookup not wired')
  return jobLookup(id)
}

export async function lookupSessionRecord(id: string): Promise<DesktopSession | null | undefined> {
  if (!sessionLookup) throw new Error('workspace session lookup not wired')
  return sessionLookup(id)
}

export async function lookupSessions(): Promise<DesktopSession[]> {
  if (!listSessionsFn) throw new Error('workspace session list not wired')
  return listSessionsFn()
}
