/**
 * Access review signature commit (Ticket 40).
 *
 * Hash-gates the displayed document, then attaches the Reviewed signature.
 * Ceremony (step-up, MFA, createSignature) stays with the route caller.
 */

import {
  prepareAccessReviewDocument,
  signAccessReviewReport,
  type AccessReviewReport,
} from './accessReview.js'
import type { SignatureRecord } from '../signing/signingCeremony.js'

export type AccessReviewSignResult =
  | { ok: true; report: AccessReviewReport; contentHash: string; content: string }
  | { ok: false; error: string }

export { prepareAccessReviewDocument }

/**
 * Sign the stored report only when `expectedHash` still matches the displayed document.
 * `sign` builds the SignatureRecord from that exact content (caller supplies ceremony).
 */
export function applyAccessReviewSign(
  report: AccessReviewReport,
  expectedHash: string,
  sign: (content: string) => SignatureRecord,
): AccessReviewSignResult {
  const prepared = prepareAccessReviewDocument(report)
  if (prepared.contentHash !== expectedHash) {
    return { ok: false, error: 'Content changed after display; signature invalidated' }
  }
  return {
    ok: true,
    report: signAccessReviewReport(report, sign(prepared.content)),
    contentHash: prepared.contentHash,
    content: prepared.content,
  }
}
