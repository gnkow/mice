// Authentication public API
// Per spec (respec/01-authentication/spec.md): "There are no PATs and no service principals"

// Author injection
export { hasAuthorQueryParam, injectAuthorFormData, injectAuthorJson, isAuthorFreeBinaryRoute } from './author.js'

// CLI device flow (RFC 8628) - replaces PATs
export { registerCliDeviceRoutes } from './credentials/cliDeviceRoutes.js'

// Authentication event log
export { registerAuthEventRoutes } from './audit/authEventRoutes.js'

// Revocation
export { registerRevocationRoutes } from './credentials/revocationRoutes.js'
export { registerAdminRevocationRoutes } from './access/adminRevocationRoutes.js'
export { registerMiceSuspensionRoutes } from './access/miceSuspensionRoutes.js'
export { registerReenableRoutes } from './access/reenableRoutes.js'
export { registerSigningRoutes } from './signing/signingRoutes.js'
export { registerIdpBaselineRoutes } from './admin/idpBaselineRoutes.js'
export { registerIdpDriftRoutes } from './compliance/idpDriftRoutes.js'
export { registerDisabledSignerRoutes } from './compliance/disabledSignerRoutes.js'
export { startIdpDriftSchedule } from './compliance/idpDriftSchedule.js'
export { registerAccessReviewRoutes } from './compliance/accessReviewRoutes.js'
export { registerNameHistoryRoutes } from './compliance/nameHistoryRoutes.js'
export { startAccessReviewAlertSchedule } from './compliance/accessReviewAlert.js'
export { startClockDriftSchedule } from './compliance/clockDriftAlert.js'
export { signOutEverywhere } from './credentials/selfRevocation.js'

// Directory sync
export { makeDirectorySyncRoute, startDirectorySyncSchedule } from './directory/directorySync.js'

// OIDC and login
export { backChannelLogout } from './oidc/backChannelLogout.js'
export { registerLoginRoutes } from './oidc/loginRoutes.js'
export { registerStepUp } from './oidc/stepUp.js'

// Session management
export { registerMeRoutes } from './session/meRoutes.js'
export { registerSealKeyRoutes } from './session/sealKeyRoutes.js'
export { startSealKeyRotationSchedule } from './session/sealKeyRotationSchedule.js'
export { can, isScopedCredential, kindOf, matchesIdentityEntry, parsePrincipalKey, principalKey } from './session/principal.js'
export { classifyPath, interpretRequest } from './session/requestInterpretation.js'
export { AuthenticationDenied, applyGlobalGuards, authenticate, authenticateOutcome, authenticateRequest, authenticateUser, callerVia, requirePrincipal, setAuthenticationObserver } from './session/requireAuth.js'
export { guarded } from './session/routeGuard.js'
export type { GuardArgs } from './session/routeGuard.js'
export { sealSession, getSession, setSessionCookie, destroySession, clearSessionCookie } from './session/session.js'
export type { CliCredentialScope, SessionUser } from './session/session.js'
export type { AuthOutcome, AuthPolicy } from './session/requireAuth.js'
export type Principal = import('./session/session.js').SessionUser
export { assertProductionStartup } from './session/startupGate.js'
export { assertIdpAssurance } from './session/idpAssuranceGate.js'
export { registerWebSessionRoutes } from './session/webSessionRoutes.js'

// REMOVED (per spec):
// - PATs (Personal Access Tokens) - use device flow (mice login) instead
// - Service Principals - Jobs use BFF-internal tokens
// Token mint routes are not part of the BFF. CLI access is the device-flow credential.
// - registerServicePrincipalRoutes, createServicePrincipal, serviceUser
// - startServicePatExpirySchedule

