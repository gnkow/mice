import type { PrincipalId } from '../session/principal.js'

/**
 * TICKET 10: Auditor Access
 * 
 * Auditors have read-only access with strict requirements:
 * - Time-limited via expiry date
 * - MFA required
 * - All reads audited
 * - No writes, no impersonation
 */

export interface AuditorRole {
  principal: PrincipalId & { name: string }
  expiresAt: number
  createdBy: PrincipalId & { name: string }
  createdAt: number
}

export interface AuditorRequest {
  auditor: AuditorRole
  operation: 'read' | 'write' | 'delete' | 'impersonate' | 'support'
  resource: string
  mfaVerified: boolean
  timestamp: number
}

export interface AuditorAuditLog {
  auditor: PrincipalId & { name: string }
  operation: string
  resource: string
  timestamp: number
}

/**
 * Create an auditor role with required expiry date.
 */
export function createAuditorRole(
  principal: PrincipalId & { name: string },
  expiresAt: number,
  createdBy: PrincipalId & { name: string },
  createdAt: number = Date.now(),
): AuditorRole {
  if (!expiresAt || expiresAt <= createdAt) {
    throw new Error('Auditor role requires valid expiry date in the future')
  }
  
  return {
    principal,
    expiresAt,
    createdBy,
    createdAt,
  }
}

/**
 * Check if auditor access has expired.
 */
export function isAuditorExpired(auditor: AuditorRole, now: number = Date.now()): boolean {
  return now >= auditor.expiresAt
}

/**
 * Validate that auditor can access at this time (not expired).
 */
export function validateAuditorExpiry(auditor: AuditorRole, now: number = Date.now()): void {
  if (isAuditorExpired(auditor, now)) {
    throw new Error('Auditor access has expired')
  }
}

/**
 * Validate that auditor has MFA.
 */
export function validateAuditorMfa(mfaVerified: boolean): void {
  if (!mfaVerified) {
    throw new Error('MFA required for auditor access')
  }
}

/**
 * Check if an operation is allowed for auditors.
 */
export function isAuditorOperationAllowed(operation: string): boolean {
  return operation === 'read'
}

/**
 * Validate that an operation is allowed for auditors.
 */
export function validateAuditorOperation(operation: string): void {
  if (!isAuditorOperationAllowed(operation)) {
    throw new Error(`Auditors cannot perform ${operation} operations (read-only access)`)
  }
}

/**
 * Validate an auditor request (expiry, MFA, operation type).
 */
export function validateAuditorRequest(request: AuditorRequest): void {
  validateAuditorExpiry(request.auditor, request.timestamp)
  validateAuditorMfa(request.mfaVerified)
  validateAuditorOperation(request.operation)
}

/**
 * Log an auditor read operation.
 */
export function logAuditorRead(
  auditor: PrincipalId & { name: string },
  resource: string,
  timestamp: number = Date.now(),
): AuditorAuditLog {
  return {
    auditor,
    operation: 'read',
    resource,
    timestamp,
  }
}

/**
 * Check if a principal is an auditor and validate their request.
 */
export function authorizeAuditorAccess(request: AuditorRequest): AuditorAuditLog {
  validateAuditorRequest(request)
  return logAuditorRead(request.auditor.principal, request.resource, request.timestamp)
}
