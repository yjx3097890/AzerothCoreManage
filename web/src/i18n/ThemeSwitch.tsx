import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { applyTheme, readStoredThemeMode, type ThemeMode } from '../theme'

function SunIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="size-4">
      <path d="M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z" />
      <path
        fillRule="evenodd"
        d="M12 1.25a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0V2A.75.75 0 0 1 12 1.25Zm0 17.5a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0V19.5a.75.75 0 0 1 .75-.75ZM22.75 12a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1 0-1.5H22a.75.75 0 0 1 .75.75ZM4.5 12a.75.75 0 0 1-.75.75H2.25a.75.75 0 0 1 0-1.5H3.75A.75.75 0 0 1 4.5 12Zm14.773-6.523a.75.75 0 0 1 0 1.06l-1.06 1.061a.75.75 0 1 1-1.061-1.06l1.06-1.061a.75.75 0 0 1 1.061 0ZM7.848 16.152a.75.75 0 0 1 0 1.06l-1.06 1.061a.75.75 0 0 1-1.061-1.06l1.06-1.061a.75.75 0 0 1 1.061 0ZM18.773 18.523a.75.75 0 0 1-1.06 0l-1.061-1.06a.75.75 0 1 1 1.06-1.061l1.061 1.06a.75.75 0 0 1 0 1.061ZM7.848 7.848a.75.75 0 0 1-1.06 0L5.727 6.787a.75.75 0 0 1 1.06-1.06l1.061 1.06a.75.75 0 0 1 0 1.061Z"
        clipRule="evenodd"
      />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="size-4">
      <path
        fillRule="evenodd"
        d="M9.528 1.718a.75.75 0 0 1 .162.819A8.97 8.97 0 0 0 9 6a9 9 0 0 0 9 9 8.97 8.97 0 0 0 3.463-.69.75.75 0 0 1 .981.98A10.503 10.503 0 0 1 12 22.5C6.201 22.5 1.5 17.799 1.5 12c0-4.368 2.667-8.112 6.46-9.763a.75.75 0 0 1 .819.162Z"
        clipRule="evenodd"
      />
    </svg>
  )
}

export function ThemeSwitch() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<ThemeMode>(() =>
    typeof document !== 'undefined' ? readStoredThemeMode() : 'light',
  )

  useEffect(() => {
    applyTheme(mode)
  }, [mode])

  const next: ThemeMode = mode === 'light' ? 'dark' : 'light'
  const label = mode === 'light' ? t('common.themeDark') : t('common.themeLight')

  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm btn-square"
      aria-label={label}
      title={label}
      onClick={() => setMode(next)}
    >
      {mode === 'light' ? <MoonIcon /> : <SunIcon />}
    </button>
  )
}
