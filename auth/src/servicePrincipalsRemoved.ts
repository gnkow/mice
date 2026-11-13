/**
 * Service principals are removed (authorization #05).
 *
 * There is no create/manage API, no `decideServicePrincipalManage`, and no
 * `serviceprincipal.admin` instance action. The retired issuer `urn:mice:service`
 * is never a caller — authenticate refuses it via `decideServiceCallerAdmission`.
 */
import { SERVICE_ISSUER } from './authentication/session/principal.js'

export const SERVICE_PRINCIPALS_REMOVED = true as const

/** Paths that used to manage service principals; they must stay unreachable. */
export const RETIRED_SERVICE_PRINCIPAL_PATHS = [
  '/auth/instance/service-principals',
  '/auth/instance/service-principals/sp-1',
  '/auth/instance/service-principals/sp-1/tokens',
] as const

export { SERVICE_ISSUER as RETIRED_SERVICE_ISSUER }
