import type { SignatureMeaning } from './signingCeremony.js'

/**
 * Optional "now known as" note for a signature view.
 * Uses the Principal's stored current name — not a live IdP lookup.
 */
export function decideNowKnownAs(
  signedName: string,
  currentName: string | null | undefined,
): string | undefined {
  if (currentName && currentName !== signedName) return currentName
  return undefined
}

/** Inputs for assembling a signature identity view (Ticket 53). */
export type SignatureIdentityInput = {
  id: string
  meaning: SignatureMeaning
  signedAt: string
  signer: { iss: string; sub: string; name: string }
}

export type SignatureIdentityView = SignatureIdentityInput & {
  nowKnownAs?: string
}

/**
 * Signature identity display: printed snapshot plus optional current-name note.
 * Store `view` fetches; this module owns the display decision.
 */
export function buildSignatureView(
  snapshot: SignatureIdentityInput,
  currentName: string | null | undefined,
): SignatureIdentityView {
  const nowKnownAs = decideNowKnownAs(snapshot.signer.name, currentName)
  return {
    id: snapshot.id,
    meaning: snapshot.meaning,
    signedAt: snapshot.signedAt,
    signer: snapshot.signer,
    ...(nowKnownAs ? { nowKnownAs } : {}),
  }
}
