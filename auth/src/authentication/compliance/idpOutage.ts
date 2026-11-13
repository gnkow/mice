import { isNull } from 'drizzle-orm'
import { getDb } from '../../db/database.js'
import { idpOutages } from '../../db/schema.js'

const paperProcedure = 'validation-pack:idp-outage'

export type IdpOutage = {
  startedAt: number
  endedAt?: number
  check: string
  requestId: string
  paperProcedure: string
}

export type IdpCheckRecord =
  | { reachable: false; at: number; check: string; requestId: string }
  | { reachable: true; at: number }

/** What `recordIdpCheck` must write given whether an incident is already open. */
export type IdpOutageMutation =
  | { action: 'noop' }
  | { action: 'open'; at: number; check: string; requestId: string }
  | { action: 'close'; at: number }

/**
 * Open-once / close-on-answer policy for IdP outage incidents (Ticket 46).
 * Reachable with no open row is a no-op; unreachable with an open row stays open.
 */
export function decideIdpOutageMutation(
  hasOpenIncident: boolean,
  input: IdpCheckRecord,
): IdpOutageMutation {
  if (input.reachable) {
    return hasOpenIncident ? { action: 'close', at: input.at } : { action: 'noop' }
  }
  if (hasOpenIncident) return { action: 'noop' }
  return {
    action: 'open',
    at: input.at,
    check: input.check,
    requestId: input.requestId,
  }
}

/**
 * Records one IdP reachability observation.
 * Unreachable opens a single open incident (first failure wins); reachable closes it.
 */
export async function recordIdpCheck(input: IdpCheckRecord): Promise<void> {
  const mutation = decideIdpOutageMutation(Boolean(await currentIdpOutage()), input)
  if (mutation.action === 'noop') return
  if (mutation.action === 'close') {
    await getDb()
      .update(idpOutages)
      .set({ endedAt: new Date(mutation.at) })
      .where(isNull(idpOutages.endedAt))
    return
  }
  await getDb().insert(idpOutages).values({
    startedAt: new Date(mutation.at),
    check: mutation.check,
    requestId: mutation.requestId,
    paperProcedure,
  })
}

function toIncident(row: typeof idpOutages.$inferSelect): IdpOutage {
  return {
    startedAt: row.startedAt.getTime(),
    ...(row.endedAt ? { endedAt: row.endedAt.getTime() } : {}),
    check: row.check,
    requestId: row.requestId,
    paperProcedure: row.paperProcedure,
  }
}

/** The incident that is still open, if the IdP has not answered since it started. */
export async function currentIdpOutage(): Promise<IdpOutage | null> {
  const [row] = await getDb().select().from(idpOutages).where(isNull(idpOutages.endedAt)).limit(1)
  return row ? toIncident(row) : null
}

/** Incidents in the order they were opened. */
export async function listIdpOutages(): Promise<IdpOutage[]> {
  const rows = await getDb().select().from(idpOutages).orderBy(idpOutages.id)
  return rows.map(toIncident)
}
