import { env } from '../../shared/index.js'
import { canonicalIssuer } from '../../authentication/principal.js'

let issuerOverride: (() => string | null | undefined) | null = null

/** Boot may wire IdP directory issuer so grants stamp the live directory iss. */
export function setGroupIssuerOverride(fn: () => string | null | undefined): void {
  issuerOverride = fn
}

/** Issuer stamped on group binding keys when the caller does not pass one. */
export function defaultGroupIssuer(): string {
  try {
    const fromDir = issuerOverride?.()
    if (fromDir) return canonicalIssuer(fromDir)
  } catch {
    /* directory may be unavailable in early unit tests */
  }
  return canonicalIssuer(env.oidcIssuerPublic || 'test')
}
