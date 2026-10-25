const NETWORK = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EPIPE', 'EAI_AGAIN', 'CONNECTION_ENDED', 'CONNECT_TIMEOUT'])

/**
 * True when the error means a backing store (PostgreSQL, immudb, Novu) cannot be reached, as opposed to a bug.
 * The service answers 503 for these and never proceeds as if the work had succeeded.
 */
export function isStoreOutage(err: unknown, depth = 0): boolean {
  if (!err || typeof err !== 'object' || depth > 5) return false
  const e = err as { code?: unknown; message?: unknown; name?: unknown; cause?: unknown; errors?: unknown }
  const code = String(e.code ?? '')
  if (NETWORK.has(code)) return true
  // PostgreSQL: class 08 (connection exception), 57P01-03 (shutdown), 53300 (too many connections).
  if (/^08/.test(code) || /^57P0[123]$/.test(code) || code === '53300') return true
  // gRPC UNAVAILABLE (immudb).
  if (e.code === 14) return true
  if (e.name === 'NovuError' && /unreachable/i.test(String(e.message ?? ''))) return true
  if (Array.isArray(e.errors) && e.errors.some((x) => isStoreOutage(x, depth + 1))) return true
  return isStoreOutage(e.cause, depth + 1)
}
