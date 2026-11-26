import type { Context } from 'hono'
import { resolveClientIp } from '../../../shared/index.js'

type ConnInfoFn = (ctx: Context) => { remote?: { address?: string } }

let cachedGetConnInfo: ConnInfoFn | null | undefined

async function loadGetConnInfo(): Promise<ConnInfoFn | null> {
  if (cachedGetConnInfo !== undefined) return cachedGetConnInfo
  try {
    const mod = await import('@hono/node-server/conninfo')
    cachedGetConnInfo = mod.getConnInfo
  } catch {
    cachedGetConnInfo = null
  }
  return cachedGetConnInfo
}

/** Best-effort TCP peer from the Node adapter; null under `app.request` tests. */
export async function peerAddressFromContext(c: Context): Promise<string | null> {
  const getConnInfo = await loadGetConnInfo()
  if (!getConnInfo) return null
  try {
    const address = getConnInfo(c).remote?.address
    return typeof address === 'string' && address.trim() ? address : null
  } catch {
    return null
  }
}

/** Client IP for device fingerprinting, or null when start must reject. */
export async function clientIpForDeviceStart(c: Context): Promise<string | null> {
  return resolveClientIp(c.req.raw.headers, await peerAddressFromContext(c))
}
