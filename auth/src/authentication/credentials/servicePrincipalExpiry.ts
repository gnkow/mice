import { eq } from 'drizzle-orm'
import { env } from '../../env.js'
import { getDb } from '../../db/database.js'
import { servicePatExpiryNotices } from '../../db/schema.js'
import { emitNotification } from '../../notifications.js'
import { getServicePrincipal } from './servicePrincipals.js'
import { listServicePats } from './tokens.js'

const DAY_MS = 86_400_000

/**
 * Notifies each service principal's current owner once per PAT when it is within `leadDays`
 * of expiry. Expired and revoked PATs are never listed. Returns how many notices were sent.
 */
export async function checkServicePatExpiry(leadDays: number = env.servicePatExpiryLeadDays): Promise<number> {
  const now = Date.now()
  let sent = 0
  for (const pat of await listServicePats()) {
    const [already] = await getDb().select().from(servicePatExpiryNotices).where(eq(servicePatExpiryNotices.patId, pat.id))
    if (already) continue
    if (Date.parse(pat.expiresAt) - now > leadDays * DAY_MS) continue
    const sp = await getServicePrincipal(pat.sub)
    if (!sp) continue
    const date = pat.expiresAt.slice(0, 10)
    await emitNotification({
      id: `service-pat-expiry:${pat.id}`,
      category: 'security',
      title: 'Service principal token expires soon',
      summary: `A token of service principal ${sp.name} expires on ${date}. Mint a replacement before CI fails.`,
      audience: 'personal',
      recipients: [{ iss: sp.owner.iss, sub: sp.owner.sub }],
      href: '/profile',
    })
    await getDb().insert(servicePatExpiryNotices).values({ patId: pat.id, notifiedAt: new Date(now) }).onConflictDoNothing()
    sent++
  }
  return sent
}

let timer: ReturnType<typeof setInterval> | undefined

export async function startServicePatExpirySchedule(): Promise<void> {
  if (timer || env.servicePatExpiryLeadDays <= 0) return
  const run = async () => { try { await checkServicePatExpiry() } catch (e) { console.error('[mice-auth] service PAT expiry check failed', e) } }
  await run()
  timer = setInterval(() => { void run() }, 60 * 60 * 1000)
  timer.unref()
}
