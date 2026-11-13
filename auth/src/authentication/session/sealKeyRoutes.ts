/**
 * Admin routes for seal key management (Ticket 17)
 */

import type { Hono } from 'hono'
import { isInstanceAdmin } from '../../authzInstanceStore.js'
import { guarded } from '../index.js'
import {
  getAllSealKeys,
  getCurrentSealKey,
  presentSealKey,
  rotateSealKeyWithAudit,
} from './sealKeys.js'

const adminGate = async (u: { sub: string; iss: string }) =>
  (await isInstanceAdmin(u)) ? null : 'Instance admin required'

const requireInstanceAdmin = {
  gate: adminGate,
  originCheck: true,
  jsonOnly: true,
} as const

export function registerSealKeyRoutes(app: Hono): void {
  /**
   * GET /auth/admin/seal-keys
   * List all seal keys (admin only)
   */
  app.get('/auth/admin/seal-keys', guarded({ gate: adminGate }, async ({ c }) => {
    const now = Math.floor(Date.now() / 1000)
    const keys = await getAllSealKeys()
    return c.json({
      keys: keys.map((key) => {
        const view = presentSealKey(key, now)
        return {
          id: view.id,
          validFrom: view.validFrom,
          validUntil: view.validUntil,
          revokedAt: view.revokedAt,
          rotationType: view.rotationType,
          createdAt: view.createdAt,
          // List uses valid|expired; isCurrent marks the primary.
          status: view.isCurrent || view.status === 'valid' ? 'valid' : 'expired',
          isCurrent: view.isCurrent,
        }
      }),
    })
  }))

  /**
   * GET /auth/admin/seal-keys/current
   * Get current primary seal key info (admin only)
   */
  app.get('/auth/admin/seal-keys/current', guarded({ gate: adminGate }, async ({ c }) => {
    const currentKey = await getCurrentSealKey()

    if (!currentKey) {
      return c.json({ error: 'No current seal key found' }, 404)
    }

    const view = presentSealKey(currentKey)
    return c.json({
      key: {
        id: view.id,
        validFrom: view.validFrom,
        validUntil: view.validUntil,
        revokedAt: view.revokedAt,
        rotationType: view.rotationType,
        createdAt: view.createdAt,
        status: 'current',
      },
    })
  }))

  /**
   * POST /auth/admin/seal-keys/rotate
   * Perform normal rotation (30-day schedule, 7-day overlap)
   */
  app.post('/auth/admin/seal-keys/rotate', guarded(requireInstanceAdmin, async ({ c, user }) => {
    const { newKey } = await rotateSealKeyWithAudit({
      kind: 'normal',
      actor: { sub: user.sub, iss: user.iss, email: user.email, name: user.name },
      via: 'session',
    })

    return c.json({
      success: true,
      key: {
        id: newKey.id,
        validFrom: newKey.validFrom,
        validUntil: newKey.validUntil,
        rotationType: newKey.rotationType,
        createdAt: newKey.createdAt.toISOString(),
      },
    })
  }))

  /**
   * POST /auth/admin/seal-keys/rotate/emergency
   * Perform emergency rotation (immediate revocation, 8-hour grace)
   */
  app.post(
    '/auth/admin/seal-keys/rotate/emergency',
    guarded({ ...requireInstanceAdmin, body: 'optional' }, async ({ c, user, body }) => {
      const reason =
        typeof body?.reason === 'string' ? body.reason : 'Emergency rotation requested'

      const result = await rotateSealKeyWithAudit({
        kind: 'emergency',
        actor: { sub: user.sub, iss: user.iss, email: user.email, name: user.name },
        via: 'session',
        reason,
      })
      if (result.kind !== 'emergency') {
        throw new Error('expected emergency rotation result')
      }
      const { oldKey, newKey } = result

      return c.json({
        success: true,
        oldKey: {
          id: oldKey.id,
          revokedAt: oldKey.revokedAt,
          gracePeriodUntil: oldKey.validUntil,
        },
        newKey: {
          id: newKey.id,
          validFrom: newKey.validFrom,
          rotationType: newKey.rotationType,
          createdAt: newKey.createdAt.toISOString(),
        },
      })
    }),
  )
}
