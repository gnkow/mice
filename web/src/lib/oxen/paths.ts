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
