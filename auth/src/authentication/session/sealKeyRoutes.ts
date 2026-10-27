/**
 * Admin routes for seal key management (Ticket 17)
 */

import type { Hono } from 'hono'
import { authorizeInstanceAction } from '../../authz.js'
import { guarded } from '../index.js'
import {
  getAllSealKeys,
  getCurrentSealKey,
  normalRotation,
  emergencyRotation,
  isKeyValidForVerification,
} from './sealKeys.js'
import { appendAudit } from '../../audit.js'

const requireInstanceAdmin = {
  requires: { capability: 'isInstanceAdmin', message: 'Instance admin required' },
  originCheck: true,
  jsonOnly: true,
} as const

export function registerSealKeyRoutes(app: Hono): void {
  /**
   * GET /auth/admin/seal-keys
   * List all seal keys (admin only)
   */
  app.get('/auth/admin/seal-keys', guarded(requireInstanceAdmin, async ({ c, user }) => {
    await authorizeInstanceAction(user, 'instance.admin')
    
    const keys = await getAllSealKeys()
    const now = Math.floor(Date.now() / 1000)
    
    // Don't expose key material in list
    const keyList = keys.map(key => ({
      id: key.id,
      validFrom: key.validFrom,
      validUntil: key.validUntil,
      revokedAt: key.revokedAt,
      rotationType: key.rotationType,
      createdAt: key.createdAt.toISOString(),
      status: isKeyValidForVerification(key, now) ? 'valid' : 'expired',
      isCurrent: key.validUntil === null && key.revokedAt === null,
    }))
    
    return c.json({ keys: keyList })
  }))
  
  /**
   * GET /auth/admin/seal-keys/current
   * Get current primary seal key info (admin only)
   */
  app.get('/auth/admin/seal-keys/current', guarded(requireInstanceAdmin, async ({ c, user }) => {
    await authorizeInstanceAction(user, 'instance.admin')
    
    const currentKey = await getCurrentSealKey()
    
    if (!currentKey) {
      return c.json({ error: 'No current seal key found' }, 404)
    }
    
    return c.json({
      key: {
        id: currentKey.id,
        validFrom: currentKey.validFrom,
        validUntil: currentKey.validUntil,
        revokedAt: currentKey.revokedAt,
        rotationType: currentKey.rotationType,
        createdAt: currentKey.createdAt.toISOString(),
        status: 'current',
      },
    })
  }))
  
  /**
   * POST /auth/admin/seal-keys/rotate
   * Perform normal rotation (30-day schedule, 7-day overlap)
   */
  app.post('/auth/admin/seal-keys/rotate', guarded(requireInstanceAdmin, async ({ c, user }) => {
    await authorizeInstanceAction(user, 'instance.admin')
    
    const newKey = await normalRotation()
    
    await appendAudit({
      actor: { sub: user.sub, iss: user.iss, email: user.email, name: user.name },
      via: 'session',
      method: 'POST',
      path: '/auth/admin/seal-keys/rotate',
      status: 200,
      action: 'seal_key.rotated',
      message: `Normal seal key rotation completed`,
      detail: {
        newKeyId: newKey.id,
        rotationType: 'normal',
        validFrom: newKey.validFrom,
      },
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
  app.post('/auth/admin/seal-keys/rotate/emergency', guarded(requireInstanceAdmin, async ({ c, user, body }) => {
    await authorizeInstanceAction(user, 'instance.admin')
    
    const reason = body?.reason ?? 'Emergency rotation requested'
    
    const { oldKey, newKey } = await emergencyRotation()
    
    await appendAudit({
      actor: { sub: user.sub, iss: user.iss, email: user.email, name: user.name },
      via: 'session',
      method: 'POST',
      path: '/auth/admin/seal-keys/rotate/emergency',
      status: 200,
      action: 'seal_key.emergency_rotation',
      message: `Emergency seal key rotation: ${reason}`,
      detail: {
        oldKeyId: oldKey.id,
        oldKeyRevokedAt: oldKey.revokedAt,
        oldKeyGraceUntil: oldKey.validUntil,
        newKeyId: newKey.id,
        rotationType: 'emergency',
        reason,
      },
    })
    
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
  }))
}
