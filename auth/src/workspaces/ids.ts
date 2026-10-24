const ID_RE = /^w_[0-9a-z]{10}$/

/** Leaf module (no imports of stores) so session code can validate ids without cycles. */
export function validWorkspaceId(id: string): boolean {
  return ID_RE.test(id)
}
