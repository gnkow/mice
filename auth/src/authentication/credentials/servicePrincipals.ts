/**
 * Service principals stub.
 * 
 * Service principals were removed per spec: "There are no PATs and no service principals".
 * This module provides stub functions for backward compatibility with offboarding code.
 */

import type { SessionUser } from '../session/session.js'

export type ServicePrincipalPublic = {
  id: string
  name: string
  reason: string
}

/**
 * Stub: suspendOwnedBy - service principals no longer exist.
 * Returns empty array since there are no service principals to suspend.
 */
export async function suspendOwnedBy(_owner: SessionUser): Promise<string[]> {
  return []
}

/**
 * Stub: isServiceCredentialActive - service principals no longer exist.
 * Always returns false.
 */
export async function isServiceCredentialActive(_id: string): Promise<boolean> {
  return false
}

/**
 * Stub: peekServicePrincipal - service principals no longer exist.
 * Always returns null.
 */
export function peekServicePrincipal(_id: string): ServicePrincipalPublic | null {
  return null
}

/**
 * Stub: getServicePrincipal - service principals no longer exist.
 * Always returns null.
 */
export async function getServicePrincipal(_id: string): Promise<ServicePrincipalPublic | null> {
  return null
}
