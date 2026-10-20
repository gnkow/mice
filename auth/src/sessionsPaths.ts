import { env } from './env.js'

/**
 * Map a path under SESSIONS_DATA_DIR (container) to SESSIONS_HOST_DATA_DIR for
 * `docker run -v` against the host Docker engine.
 */
export function toSessionsDockerHostPath(containerPath: string): string {
  const hostRoot = env.sessionsHostDataDir
  if (!hostRoot) return containerPath
  const containerRoot = env.sessionsDataDir
  if (
    containerPath === containerRoot ||
    containerPath.startsWith(`${containerRoot}/`)
  ) {
    return `${hostRoot}${containerPath.slice(containerRoot.length)}`
  }
  return containerPath
}

export { sessionsWorkDir } from './sessionsStore.js'
