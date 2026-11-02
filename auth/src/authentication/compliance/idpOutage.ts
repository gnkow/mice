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

/** Closes the open incident when the IdP answers. */
export async function closeIdpOutage(at: number): Promise<void> {
  await getDb().update(idpOutages).set({ endedAt: new Date(at) }).where(isNull(idpOutages.endedAt))
}

/** Opens an incident for an unreachable IdP. A second failure in the same outage keeps the first. */
export async function noteIdpOutage(input: { at: number; check: string; requestId: string }): Promise<void> {
  if (await currentIdpOutage()) return
  await getDb().insert(idpOutages).values({
    startedAt: new Date(input.at),
    check: input.check,
    requestId: input.requestId,
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
