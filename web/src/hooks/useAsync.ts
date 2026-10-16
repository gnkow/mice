import { useCallback, useEffect, useRef, useState } from 'react'

export type AsyncState<T> =
  | { kind: 'loading' }
  | { kind: 'ok'; data: T }
  | { kind: 'error'; message: string }

/**
 * Async data hook. `reload()` refreshes without clearing prior `ok` data
 * (stale-while-revalidate). Dependency changes reset to loading.
 */
export function useAsync<T>(
  factory: (signal: AbortSignal) => Promise<T>,
  deps: unknown[],
): AsyncState<T> & { reload: () => void } {
  const [tick, setTick] = useState(0)
  const [state, setState] = useState<AsyncState<T>>({ kind: 'loading' })
  const softReload = useRef(false)

  const reload = useCallback(() => {
    softReload.current = true
    setTick((t) => t + 1)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const keepStale = softReload.current
    softReload.current = false
    if (!keepStale) {
      setState({ kind: 'loading' })
    }
    factory(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ kind: 'ok', data })
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setState({
          kind: 'error',
          message: err instanceof Error ? err.message : 'Request failed',
        })
      })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  return { ...state, reload }
}
