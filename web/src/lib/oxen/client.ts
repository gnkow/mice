import { loadSettings } from './settings'
import { OxenApiError, type StatusMessage } from './types'

export type RequestOptions = {
  method?: string
  body?: unknown
  formData?: FormData
  /** Raw body (e.g. gzip bytes); use with contentType. */
  binaryBody?: BodyInit
  contentType?: string
  accept?: string
  signal?: AbortSignal
  /** When true, return Response without JSON parsing (file download). */
  raw?: boolean
}

function resolveUrl(path: string): string {
  const { apiBase } = loadSettings()
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `${apiBase}${normalized}`
}

export async function oxenFetch<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: options.accept ?? 'application/json',
  }

  let body: BodyInit | undefined
  if (options.formData) {
    body = options.formData
  } else if (options.binaryBody !== undefined) {
    if (options.contentType) headers['Content-Type'] = options.contentType
    body = options.binaryBody
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(options.body)
  }

  const res = await fetch(resolveUrl(path), {
    method: options.method ?? 'GET',
    headers,
    body,
    signal: options.signal,
    credentials: 'same-origin',
  })

  if (options.raw) {
    if (!res.ok) {
      const text = await res.text()
      let parsed: StatusMessage | null = null
      try {
        parsed = JSON.parse(text) as StatusMessage
      } catch {
        /* ignore */
      }
      throw new OxenApiError(
        parsed?.error?.detail ||
          parsed?.status_message ||
          text ||
          res.statusText,
        res.status,
        parsed,
      )
    }
    return res as T
  }

  const text = await res.text()
  let parsed: StatusMessage | null = null
  if (text) {
    try {
      parsed = JSON.parse(text) as StatusMessage
    } catch {
      parsed = null
    }
  }

  if (!res.ok || parsed?.status === 'error') {
    const detail =
      parsed?.error?.detail ||
      parsed?.status_description ||
      parsed?.status_message ||
      text ||
      res.statusText
    throw new OxenApiError(detail, res.status, parsed)
  }

  return parsed as T
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  )
  const value = bytes / 1024 ** i
  return `${value < 10 && i > 0 ? value.toFixed(1) : Math.round(value)} ${units[i]}`
}
