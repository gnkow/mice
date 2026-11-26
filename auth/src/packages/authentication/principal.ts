/** Leaf identity helpers/types — no seal keys, no audit. */
export {
  can,
  decideServiceCallerAdmission,
  isScopedCredential,
  isServiceCaller,
  kindOf,
  matchesIdentityEntry,
  parsePrincipalKey,
  principalKey,
  canonicalIssuer,
  normalizePrincipalAuthorKey,
  SERVICE_ISSUER,
  signerAuthorKey,
} from './lib/session/principal.js'
export type { CliCredentialScope, SessionUser, PrincipalId } from './lib/session/principal.js'
