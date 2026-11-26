/** Name-reuse quarantine after delete/rename (90 days). */
export const TOMBSTONE_MS = 90 * 24 * 60 * 60 * 1000

/** Pure decision: is a tombstoned name still reserved at `now`? */
export function isNameReservedByTombstone(deletedAt: Date, now = Date.now()): boolean {
  return now - deletedAt.getTime() < TOMBSTONE_MS
}
