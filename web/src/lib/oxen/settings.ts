const BASE_KEY = 'boxen.oxenApiBase'
const TOKEN_KEY = 'boxen.oxenToken'

export type OxenSettings = {
  /** Empty = same-origin `/api` (Vite proxy to auth BFF). */
  apiBase: string
  /** Break-glass bearer accepted by the BFF (`AUTH_BREAKGLASS_TOKEN`). */
  token: string
}

export function loadSettings(): OxenSettings {
  return {
    apiBase: (localStorage.getItem(BASE_KEY) ?? '').trim().replace(/\/$/, ''),
    token: localStorage.getItem(TOKEN_KEY) ?? '',
  }
}

export function saveSettings(next: OxenSettings): void {
  localStorage.setItem(BASE_KEY, next.apiBase.trim().replace(/\/$/, ''))
  localStorage.setItem(TOKEN_KEY, next.token.trim())
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
