const BASE_KEY = 'boxen.oxenApiBase'
const TOKEN_KEY = 'boxen.oxenToken'
const AUTHOR_NAME_KEY = 'boxen.authorName'
const AUTHOR_EMAIL_KEY = 'boxen.authorEmail'

export type OxenSettings = {
  /** Empty = same-origin `/api` (Vite proxy to oxen-server). */
  apiBase: string
  token: string
  authorName: string
  authorEmail: string
}

export function loadSettings(): OxenSettings {
  return {
    apiBase: (localStorage.getItem(BASE_KEY) ?? '').trim().replace(/\/$/, ''),
    token: localStorage.getItem(TOKEN_KEY) ?? '',
    authorName: localStorage.getItem(AUTHOR_NAME_KEY) ?? 'Boxen',
    authorEmail: localStorage.getItem(AUTHOR_EMAIL_KEY) ?? 'boxen@localhost',
  }
}

export function saveSettings(next: OxenSettings): void {
  localStorage.setItem(BASE_KEY, next.apiBase.trim().replace(/\/$/, ''))
  localStorage.setItem(TOKEN_KEY, next.token.trim())
  localStorage.setItem(AUTHOR_NAME_KEY, next.authorName.trim() || 'Boxen')
  localStorage.setItem(
    AUTHOR_EMAIL_KEY,
    next.authorEmail.trim() || 'boxen@localhost',
  )
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
