import { REASON_HEADER } from '../../audit/index.js'
import { CHANGE_CONTROL_HEADER } from '../../merge/index.js'
import { SIGNATURE_HEADER } from '../../merge/index.js'

export const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
  'cookie',
  'authorization',
  REASON_HEADER,
  CHANGE_CONTROL_HEADER,
  SIGNATURE_HEADER,
])

export function filterRequestHeaders(headers: Headers): Headers {
  const out = new Headers()
  headers.forEach((value, key) => {
    if (HOP_BY_HOP.has(key.toLowerCase())) return
    out.set(key, value)
  })
  return out
}
