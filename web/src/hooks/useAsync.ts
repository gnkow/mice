import { useEffect, useState } from 'react'

export type AsyncState<T> =
  | { kind: 'loading' }
  | { kind: 'ok'; data: T }
  | { kind: 'error'; message: string }

export function useAsync<T>(
  factory: (signal: AbortSignal) => Promise<T>,
  deps: unknown[],
): AsyncState<T> & { reload: () => void } {
  const [tick, setTick] = useState(0)
  const [state, setState] = useState<AsyncState<T>>({ kind: 'loading' })

  useEffect(() => {
    const controller = new AbortController()
    setState({ kind: 'loading' })
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

  return { ...state, reload: () => setTick((t) => t + 1) }
}
