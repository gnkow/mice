import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { describe, it } from 'node:test'
import { getDb } from '../../db/database.js'
import { queryAudit } from '../../audit.js'
import { sealKeys } from '../../db/schema.js'
import { ensureBootstrapKey, getCurrentSealKey, getSealKeyById } from './sealKeys.js'
import { startSealKeyRotationSchedule } from './sealKeyRotationSchedule.js'

const DAY = 24 * 60 * 60
const THIRTY_DAYS = 30 * DAY
const SEVEN_DAYS = 7 * DAY

describe('scheduled seal-key rotation', () => {
  it('does not rotate a seal key younger than 30 days', async () => {
    await getDb().delete(sealKeys)
    await ensureBootstrapKey()
    const before = await getCurrentSealKey()
    const at = before!.validFrom
    await getDb().update(sealKeys).set({ validFrom: at - THIRTY_DAYS + 1 }).where(eq(sealKeys.id, before!.id))

    const schedule = startSealKeyRotationSchedule({ now: () => at, poll: false })
    assert.equal(await schedule.tick(), false)
    assert.equal((await getCurrentSealKey())!.id, before!.id)
    schedule.stop()
  })

  it('rotates a 30-day-old key and keeps the previous key for 7 days', async () => {
    await getDb().delete(sealKeys)
    await ensureBootstrapKey()
    const before = await getCurrentSealKey()
    const at = before!.validFrom
    await getDb().update(sealKeys).set({ validFrom: at - THIRTY_DAYS }).where(eq(sealKeys.id, before!.id))

    const schedule = startSealKeyRotationSchedule({ now: () => at, poll: false })
    assert.equal(await schedule.tick(), true)
    const current = await getCurrentSealKey()
    assert.notEqual(current!.id, before!.id)
    assert.equal(current!.rotationType, 'normal')
    assert.equal(current!.validFrom, at)
    assert.equal(current!.revokedAt, null)
    const previous = await getSealKeyById(before!.id)
    assert.equal(previous!.validUntil, at + SEVEN_DAYS)
    assert.equal(previous!.revokedAt, null)
    assert.equal(await schedule.tick(), false)
    assert.equal((await getCurrentSealKey())!.id, current!.id)
    schedule.stop()
  })

  it('records the same rotation audit event as a manual normal rotation', async () => {
    await getDb().delete(sealKeys)
    await ensureBootstrapKey()
    const before = await getCurrentSealKey()
    const at = before!.validFrom
    await getDb().update(sealKeys).set({ validFrom: at - THIRTY_DAYS }).where(eq(sealKeys.id, before!.id))

    const schedule = startSealKeyRotationSchedule({ now: () => at, poll: false })
    assert.equal(await schedule.tick(), true)
    schedule.stop()
    const current = await getCurrentSealKey()
    const event = (await queryAudit({ action: 'seal_key.rotated', limit: 20 })).events.find(
      (entry) => entry.detail?.newKeyId === current!.id,
    )
    assert.equal(event?.actor.sub, 'seal-key-rotation')
    assert.equal(event?.actor.iss, 'urn:mice:system')
    assert.equal(event?.actor.name, 'Seal key rotation')
    assert.equal(event?.via, 'system')
    assert.equal(event?.message, 'Normal seal key rotation completed')
    assert.equal(event?.detail?.rotationType, 'normal')
    assert.equal(event?.detail?.validFrom, at)
  })
})
