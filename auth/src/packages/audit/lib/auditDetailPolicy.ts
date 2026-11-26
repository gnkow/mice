/** Rejects secrets and unsafe detail before an audit event is stored (US10 / Q25). */

export type DetailPolicyRejection = {
  code: 'audit_detail_forbidden' | 'audit_secret_detected'
  detail: string
}

export type DetailPolicyResult =
  | { ok: true; detail?: Record<string, unknown> }
  | { ok: false; rejection: DetailPolicyRejection }

/** Never allowed as detail keys (case-insensitive). */
export const FORBIDDEN_DETAIL_KEYS = new Set([
  'token',
  'access_token',
  'accesstoken',
  'refresh_token',
  'refreshtoken',
  'id_token',
  'idtoken',
  'cookie',
  'authorization',
  'password',
  'passwd',
  'secret',
  'client_secret',
  'clientsecret',
  'api_key',
  'apikey',
  'private_key',
  'privatekey',
])

/**
 * When an action appears here, only these keys (plus none of the forbidden set) are allowed.
 * Actions not listed are open except for forbidden keys + secret scanning — expanded by schema work (#130).
 */
export const ACTION_DETAIL_ALLOWLIST: Record<string, ReadonlySet<string>> = {
  'audit.browse': new Set(['rows', 'has_more', 'filters']),
  'audit.export': new Set(['rows', 'truncated', 'filters', 'format']),
  'audit.break.acknowledge': new Set(['seq', 'reason']),
}

const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'mice_pat', re: /mice_pat_[A-Za-z0-9_-]{8,}/i },
  { name: 'bearer', re: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/i },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/ },
  { name: 'aws_key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'password_assign', re: /\bpassword\s*[=:]\s*\S+/i },
  { name: 'api_key_assign', re: /\bapi[_-]?key\s*[=:]\s*\S+/i },
  { name: 'secret_assign', re: /\b(client_)?secret\s*[=:]\s*\S+/i },
]

/** True when `text` matches a known secret/token pattern. */
export function textContainsSecret(text: string): string | null {
  for (const p of SECRET_PATTERNS) {
    if (p.re.test(text)) return p.name
  }
  return null
}

function scanValue(value: unknown, path: string): string | null {
  if (typeof value === 'string') {
    const hit = textContainsSecret(value)
    return hit ? `${hit} at ${path}` : null
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = scanValue(value[i], `${path}[${i}]`)
      if (hit) return hit
    }
    return null
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_DETAIL_KEYS.has(k.toLowerCase())) {
        return `forbidden_key at ${path}.${k}`
      }
      const hit = scanValue(v, `${path}.${k}`)
      if (hit) return hit
    }
  }
  return null
}

/**
 * Enforce forbidden keys, optional per-action allowlist, and secret patterns on
 * reason / message / detail.
 */
export function validateAuditDetail(input: {
  action: string
  reason?: string
  message?: string
  detail?: Record<string, unknown>
}): DetailPolicyResult {
  for (const [label, text] of [
    ['reason', input.reason],
    ['message', input.message],
  ] as const) {
    if (text) {
      const hit = textContainsSecret(text)
      if (hit) {
        return {
          ok: false,
          rejection: {
            code: 'audit_secret_detected',
            detail: `Secret pattern (${hit}) rejected in ${label}`,
          },
        }
      }
    }
  }

  if (!input.detail || Object.keys(input.detail).length === 0) {
    return { ok: true }
  }

  const keys = Object.keys(input.detail)
  const banned = keys.filter((k) => FORBIDDEN_DETAIL_KEYS.has(k.toLowerCase()))
  if (banned.length > 0) {
    return {
      ok: false,
      rejection: {
        code: 'audit_detail_forbidden',
        detail: `Forbidden detail keys: ${banned.sort().join(', ')}`,
      },
    }
  }

  const allow = ACTION_DETAIL_ALLOWLIST[input.action]
  if (allow) {
    const unknown = keys.filter((k) => !allow.has(k))
    if (unknown.length > 0) {
      return {
        ok: false,
        rejection: {
          code: 'audit_detail_forbidden',
          detail: `Detail keys not allowlisted for ${input.action}: ${unknown.sort().join(', ')}`,
        },
      }
    }
  }

  const secretHit = scanValue(input.detail, 'detail')
  if (secretHit) {
    const code = secretHit.startsWith('forbidden_key')
      ? 'audit_detail_forbidden'
      : 'audit_secret_detected'
    return {
      ok: false,
      rejection: {
        code,
        detail: `Secret or forbidden field rejected (${secretHit})`,
      },
    }
  }

  return { ok: true, detail: input.detail }
}

export class AuditDetailPolicyError extends Error {
  readonly code: DetailPolicyRejection['code']
  constructor(rejection: DetailPolicyRejection) {
    super(rejection.detail)
    this.name = 'AuditDetailPolicyError'
    this.code = rejection.code
  }
}
