import { getCommitQc } from './commitQcStore.js'

/** Refused when a Pin would bind a Job (or Desktop Session) to a QC Failed commit. */
export class PinRefusedError extends Error {
  readonly code = 'pin_refused' as const
  readonly status = 409 as const

  constructor(commitId: string) {
    super(`Pin refused: commit ${commitId} is QC Failed`)
    this.name = 'PinRefusedError'
  }
}

/**
 * Pin gate for Job / Desktop Session bind: refuse when the commit's QC status is Failed.
 * Allowed: none, marked, passed.
 */
export async function assertPinAllowed(repositoryId: string, commitId: string): Promise<void> {
  const status = await getCommitQc(repositoryId, commitId)
  if (status === 'failed') throw new PinRefusedError(commitId)
}
