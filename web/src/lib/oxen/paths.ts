/** Join branch + optional path into an Oxen resource path (URL-encoded segments). */
export function resourcePath(branch: string, path = ''): string {
  const parts = [branch, ...path.split('/').filter(Boolean)]
  return parts.map(encodeURIComponent).join('/')
}

/**
 * Two-dot revision range for compare/merge.
 * Do not encode `..` — oxen-server 0.61 routes break when dots are percent-encoded.
 */
export function baseHead(base: string, head: string): string {
  return `${base}..${head}`
}

export function joinPath(...parts: string[]): string {
  return parts
    .flatMap((p) => p.split('/'))
    .filter(Boolean)
    .join('/')
}

export function parentPath(path: string): string {
  const parts = path.split('/').filter(Boolean)
  parts.pop()
  return parts.join('/')
}

export function baseName(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] || path
}

/**
 * Oxen commit ids are lowercase hex (typically 32 chars). Used to avoid
 * calling branch-only endpoints with a revision hash.
 */
export function looksLikeCommitId(ref: string): boolean {
  return /^[0-9a-f]{16,64}$/i.test(ref.trim())
}

/** Same parent directory + different basename → rename; else move. */
export function isRenamePathChange(fromPath: string, toPath: string): boolean {
  const from = fromPath.replace(/^\/+|\/+$/g, '')
  const to = toPath.replace(/^\/+|\/+$/g, '')
  if (!from || !to || from === to) return false
  return parentPath(from) === parentPath(to) && baseName(from) !== baseName(to)
}
