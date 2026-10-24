/** Reject proxied paths whose meaning could differ between the BFF and oxen-server. */
export function nonCanonicalPathReason(pathname: string): string | null {
  if (pathname.includes('\\')) return 'backslash'
  if (pathname.includes('//')) return 'double_slash'
  if (/%(2f|5c|00)/i.test(pathname)) return 'encoded_separator_or_nul'
  if (/%2e/i.test(pathname)) return 'encoded_dot'
  try {
    decodeURIComponent(pathname)
  } catch {
    return 'malformed_escape'
  }
  return null
}
