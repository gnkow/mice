const BASE_KEY = 'boxen.oxenApiBase'

export type OxenSettings = {
  /** Empty = same-origin `/api` (Vite proxy to auth BFF). */
  apiBase: string
}

export function loadSettings(): OxenSettings {
  return {
    apiBase: (localStorage.getItem(BASE_KEY) ?? '').trim().replace(/\/$/, ''),
  }
}

export function saveSettings(next: OxenSettings): void {
  localStorage.setItem(BASE_KEY, next.apiBase.trim().replace(/\/$/, ''))
  // Drop legacy break-glass bearer if present.
  localStorage.removeItem('boxen.oxenToken')
  window.dispatchEvent(new Event('boxen:settings'))
}

export function subscribeSettings(onChange: () => void): () => void {
  const handler = () => onChange()
  window.addEventListener('boxen:settings', handler)
  window.addEventListener('storage', handler)
  return () => {
    window.removeEventListener('boxen:settings', handler)
    window.removeEventListener('storage', handler)
  }
}
