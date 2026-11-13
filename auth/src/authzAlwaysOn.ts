/**
 * Authorization is always enforced. The AUTHZ_ENFORCE toggle and stored enforce
 * flag are gone; callers report this constant rather than reading config.
 */
export const AUTHORIZATION_ALWAYS_ON = true as const

/** Shape embedded in `/auth/me/authz` and `/auth/instance` responses. */
export function authzEnforceReport(): { enforce: true } {
  return { enforce: AUTHORIZATION_ALWAYS_ON }
}
