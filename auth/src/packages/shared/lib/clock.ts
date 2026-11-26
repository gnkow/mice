/** Time seam: epoch milliseconds. Production reads the system clock; tests use `fakeClock`. */
export interface Clock {
  now(): number
}

/** Reads `Date.now()` on every call, so it also follows any runtime override of it. */
export const systemClock: Clock = { now: () => Date.now() }

export type FakeClock = Clock & { advance(ms: number): void; set(ms: number): void }

export function fakeClock(start = Date.UTC(2026, 0, 1)): FakeClock {
  let t = start
  return {
    now: () => t,
    advance: (ms) => void (t += ms),
    set: (ms) => void (t = ms),
  }
}

let ambient: Clock = systemClock

/** The process clock used by modules that were not handed one explicitly. */
export const currentClock: Clock = { now: () => ambient.now() }

/** Swap the process clock; returns a function restoring the previous one. */
export function useClock(next: Clock): () => void {
  const prev = ambient
  ambient = next
  return () => {
    ambient = prev
  }
}
