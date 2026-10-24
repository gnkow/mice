import { join } from 'node:path'
import { env } from './env.js'
import { readJsonFile, writeJsonFile } from './jsonStore.js'
import { emitNotification } from './notifications.js'
import { getServicePrincipal } from './servicePrincipals.js'
import { listServicePats } from './tokens.js'

const DAY_MS = 86_400_000
const statePath = () => join(env.dataDir, 'service-pat-expiry-notified.json')

/**
 * Notifies each service principal's current owner once per PAT when it is within `leadDays`
 * of expiry. Expired and revoked PATs are never listed. Returns how many notices were sent.
 */
export function checkServicePatExpiry(leadDays: number = env.servicePatExpiryLeadDays): number {
  const notified = readJsonFile<Record<string, string>>(statePath(), {})
  const now = Date.now()
  let sent = 0
  for (const pat of listServicePats()) {
    if (notified[pat.id]) continue
    if (Date.parse(pat.expiresAt) - now > leadDays * DAY_MS) continue
    const sp = getServicePrincipal(pat.sub)
    if (!sp) continue
    const date = pat.expiresAt.slice(0, 10)
    emitNotification({
      id: `service-pat-expiry:${pat.id}`,
      category: 'security',
      title: 'Service principal token expires soon',
      summary: `A token of service principal ${sp.name} expires on ${date}. Mint a replacement before CI fails.`,
      audience: 'personal',
      recipients: [{ iss: sp.owner.iss, sub: sp.owner.sub }],
      href: '/profile',
    })
    notified[pat.id] = new Date(now).toISOString()
    sent++
  }
  if (sent) writeJsonFile(statePath(), notified)
  return sent
}

let timer: ReturnType<typeof setInterval> | undefined

export function startServicePatExpirySchedule(): void {
  if (timer || env.servicePatExpiryLeadDays <= 0) return
  const run = () => { try { checkServicePatExpiry() } catch (e) { console.error('[mice-auth] service PAT expiry check failed', e) } }
  run()
  timer = setInterval(run, 60 * 60 * 1000)
  timer.unref()
}
