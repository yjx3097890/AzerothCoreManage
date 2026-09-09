import { ConfigProvider } from 'antd'
import enUS from 'antd/locale/en_US'
import zhCN from 'antd/locale/zh_CN'
import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

export function AppLocale({ children }: { children: ReactNode }) {
  const { i18n, t } = useTranslation()
  const locale = i18n.language.startsWith('zh') ? zhCN : enUS

  useEffect(() => {
    document.title = t('app.documentTitle')
  }, [t])

  return <ConfigProvider locale={locale}>{children}</ConfigProvider>
}
