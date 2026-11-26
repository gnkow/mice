/** Session face for routes/composition. Prefer principal.ts for leaf identity types. */
export * from './principal.js'
export {
  AuthenticationDenied,
  applyGlobalGuards,
  authenticate,
  authenticateOutcome,
  authenticateRequest,
  authenticateUser,
  callerVia,
  requirePrincipal,
  setAuthenticationObserver,
} from './lib/session/requireAuth.js'
export type { AuthOutcome, AuthPolicy } from './lib/session/requireAuth.js'
export { guarded, changeCaptureResponse } from './lib/session/routeGuard.js'
export type { GuardArgs } from './lib/session/routeGuard.js'
export {
  sealSession,
  getSession,
  setSessionCookie,
  destroySession,
  clearSessionCookie,
  ensurePrincipal,
} from './lib/session/session.js'
export { classifyPath, interpretRequest } from './lib/session/requestInterpretation.js'
export { assertProductionStartup, productionStartupProblems } from './lib/session/startupGate.js'
export { assertIdpAssurance, assessIdpAssurance } from './lib/session/idpAssuranceGate.js'

export { ensureBootstrapKey } from './lib/session/sealKeys.js'
export { startSealKeyRotationSchedule } from './lib/session/sealKeyRotationSchedule.js'
