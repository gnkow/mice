/** Relative time like "3 days ago"; absolute ISO in `title` via callers. */
export function formatRelativeTime(
  iso: string | number | Date,
  now = Date.now(),
): string {
  const t = iso instanceof Date ? iso.getTime() : new Date(iso).getTime()
  if (Number.isNaN(t)) return '—'
  const sec = Math.round((now - t) / 1000)
  const abs = Math.abs(sec)
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  if (abs < 60) return rtf.format(-sec, 'second')
  const min = Math.round(sec / 60)
  if (Math.abs(min) < 60) return rtf.format(-min, 'minute')
  const hr = Math.round(min / 60)
  if (Math.abs(hr) < 24) return rtf.format(-hr, 'hour')
  const day = Math.round(hr / 24)
  if (Math.abs(day) < 30) return rtf.format(-day, 'day')
  const month = Math.round(day / 30)
  if (Math.abs(month) < 12) return rtf.format(-month, 'month')
  return rtf.format(-Math.round(month / 12), 'year')
}

/** Calendar day key for grouping (local timezone). */
export function dayKey(iso: string | number | Date): string {
  const d = iso instanceof Date ? iso : new Date(iso)
  if (Number.isNaN(d.getTime())) return 'unknown'
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function formatDayHeading(iso: string | number | Date): string {
  const d = iso instanceof Date ? iso : new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Unknown date'
  const today = new Date()
  const yday = new Date(today)
  yday.setDate(today.getDate() - 1)
  if (dayKey(d) === dayKey(today)) return 'Today'
  if (dayKey(d) === dayKey(yday)) return 'Yesterday'
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
