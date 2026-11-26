const DEVICE_NAME_MAX = 64

/** Trim and bound a CLI/device display name; null when empty or invalid. */
export function normalizeDeviceName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().replace(/\s+/g, ' ')
  if (!trimmed) return null
  return trimmed.slice(0, DEVICE_NAME_MAX)
}
