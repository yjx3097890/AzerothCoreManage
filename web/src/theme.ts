export const THEME_STORAGE_KEY = 'acmanage.theme'

export const THEMES = {
  light: 'corporate',
  dark: 'business',
} as const

export type ThemeMode = keyof typeof THEMES
export type DaisyTheme = (typeof THEMES)[ThemeMode]

export function isThemeMode(v: string | null | undefined): v is ThemeMode {
  return v === 'light' || v === 'dark'
}

export function resolveThemeMode(stored?: string | null): ThemeMode {
  if (isThemeMode(stored)) return stored
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }
  return 'light'
}

export function applyTheme(mode: ThemeMode) {
  const theme = THEMES[mode]
  document.documentElement.setAttribute('data-theme', theme)
  document.documentElement.classList.toggle('dark', mode === 'dark')
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode)
  } catch {
    /* ignore quota / private mode */
  }
}

export function readStoredThemeMode(): ThemeMode {
  try {
    return resolveThemeMode(localStorage.getItem(THEME_STORAGE_KEY))
  } catch {
    return resolveThemeMode(null)
  }
}
