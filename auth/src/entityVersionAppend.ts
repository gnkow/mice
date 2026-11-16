/**
 * Shared close-then-open interval for entity version history (tickets 21–24).
 * Callers supply store-specific close/open; this seam only guarantees order and a shared `at`.
 */
export async function appendVersionInterval(opts: {
  closeOpen: (at: Date) => Promise<void>
  openNext: (at: Date) => Promise<void>
  at?: Date
}): Promise<void> {
  const at = opts.at ?? new Date()
  await opts.closeOpen(at)
  await opts.openNext(at)
}
