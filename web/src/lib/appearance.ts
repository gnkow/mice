export type ColorMode = 'light' | 'dark' | 'system'
export type DiffPalette = 'default' | 'colorblind'

export type Appearance = {
  colorMode: ColorMode
  diffPalette: DiffPalette
}

const KEY = 'mice.appearance'

const DEFAULTS: Appearance = {
  colorMode: 'system',
  diffPalette: 'default',
}

export function loadAppearance(): Appearance {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<Appearance>
    const colorMode =
      parsed.colorMode === 'light' ||
      parsed.colorMode === 'dark' ||
      parsed.colorMode === 'system'
        ? parsed.colorMode
        : DEFAULTS.colorMode
    const diffPalette =
      parsed.diffPalette === 'colorblind' ? 'colorblind' : 'default'
    return { colorMode, diffPalette }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveAppearance(next: Appearance): void {
  localStorage.setItem(KEY, JSON.stringify(next))
  applyAppearance(next)
  window.dispatchEvent(new Event('mice:appearance'))
}

export function resolvedColorMode(mode: ColorMode): 'light' | 'dark' {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
  }
  return mode
}

export function applyAppearance(next = loadAppearance()): void {
  const resolved = resolvedColorMode(next.colorMode)
  const root = document.documentElement
  root.dataset.colorMode = resolved
  root.dataset.diffPalette = next.diffPalette
  root.style.colorScheme = resolved
}

export function subscribeAppearance(onChange: () => void): () => void {
  const handler = () => onChange()
  window.addEventListener('mice:appearance', handler)
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  media.addEventListener('change', handler)
  return () => {
    window.removeEventListener('mice:appearance', handler)
    media.removeEventListener('change', handler)
  }
}
