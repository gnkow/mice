import { spawn } from 'node:child_process'
import { platform } from 'node:os'

/** Best-effort open URL in the default browser. */
export function openBrowser(url) {
  const plat = platform()
  try {
    if (plat === 'darwin') {
      spawn('open', [url], { stdio: 'ignore', detached: true }).unref()
      return true
    }
    if (plat === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], {
        stdio: 'ignore',
        detached: true,
      }).unref()
      return true
    }
    spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref()
    return true
  } catch {
    return false
  }
}
