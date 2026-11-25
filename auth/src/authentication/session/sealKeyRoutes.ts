/**
 * Admin routes for seal key management (Ticket 17)
 */

import type { Hono } from 'hono'
import { adminRoleGate } from '../../decisionHttp.js'
import { guarded } from '../index.js'
import {
  getAllSealKeys,
  getCurrentSealKey,
  presentSealKey,
  rotateSealKeyWithAudit,
} from './sealKeys.js'

const requireInstanceAdmin = {
  gate: adminRoleGate,
  originCheck: true,
  jsonOnly: true,
} as const

export function registerSealKeyRoutes(app: Hono): void {
  /**
   * GET /auth/admin/seal-keys
   * List all seal keys (admin only)
   */
  app.get('/auth/admin/seal-keys', guarded({ gate: adminRoleGate }, async ({ c }) => {
    const now = Math.floor(Date.now() / 1000)
    const keys = await getAllSealKeys()
    return c.json({ keys: keys.map((key) => presentSealKey(key, now)) })
  }))

  /**
   * GET /auth/admin/seal-keys/current
   * Get current primary seal key info (admin only)
   */
  app.get('/auth/admin/seal-keys/current', guarded({ gate: adminRoleGate }, async ({ c }) => {
    const currentKey = await getCurrentSealKey()

    if (!currentKey) {
      return c.json({ error: 'No current seal key found' }, 404)
    }

    return c.json({ key: presentSealKey(currentKey) })
  }))

  /**
   * POST /auth/admin/seal-keys/rotate
   * Perform normal rotation (30-day schedule, 7-day overlap)
   */
  app.post(
    '/auth/admin/seal-keys/rotate',
    guarded(
      { ...requireInstanceAdmin, reason: true, body: 'optional', mutates: true },
      async ({ c, user, audit }) => {
        const { newKey } = await rotateSealKeyWithAudit(
          {
            kind: 'normal',
            actor: { sub: user.sub, iss: user.iss, email: user.email, name: user.name },
            via: 'session',
          },
          {
            // Route-guard audit merges ceremony evidence onto this mutation row.
            audit: async (event) => {
              await audit({
                action: event.action,
                message: event.message,
                detail: event.detail,
                status: event.status,
                change: event.change,
              })
            },
          },
        )

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
      },
    ),
  )

  /**
   * POST /auth/admin/seal-keys/rotate/emergency
   * Perform emergency rotation (immediate revocation, 8-hour grace)
   */
  app.post(
    '/auth/admin/seal-keys/rotate/emergency',
    guarded(
      { ...requireInstanceAdmin, reason: true, body: 'optional', mutates: true },
      async ({ c, user, body, audit }) => {
        const reason =
          typeof body?.reason === 'string' ? body.reason : 'Emergency rotation requested'

        const result = await rotateSealKeyWithAudit(
          {
            kind: 'emergency',
            actor: { sub: user.sub, iss: user.iss, email: user.email, name: user.name },
            via: 'session',
            reason,
          },
          {
            audit: async (event) => {
              await audit({
                action: event.action,
                message: event.message,
                detail: event.detail,
                status: event.status,
                change: event.change,
              })
            },
          },
        )
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
      },
    ),
  )
}
