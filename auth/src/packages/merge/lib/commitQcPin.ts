/**
 * Pin / Job bind gate (ADR 0009): Invalid is soft — Pins and Jobs may use any commit.
 * Kept as a no-op seam so callers do not need conditional QC checks.
 */
export class PinRefusedError extends Error {
  readonly code = 'pin_refused' as const
  readonly status = 409 as const

  constructor(commitId: string) {
    super(`Pin refused: commit ${commitId}`)
    this.name = 'PinRefusedError'
  }
}

/** Always allows; Invalid no longer blocks Pins/Jobs. */
export async function assertPinAllowed(
  _repositoryId: string,
  _commitId: string,
): Promise<void> {
  /* no-op */
}
