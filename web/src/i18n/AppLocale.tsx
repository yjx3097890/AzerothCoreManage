import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

export function AppLocale({ children }: { children: ReactNode }) {
  const { t } = useTranslation()

  useEffect(() => {
    document.title = t('app.documentTitle')
  }, [t])

  return children
}
