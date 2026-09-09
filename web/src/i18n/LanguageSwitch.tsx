import { Segmented } from 'antd'
import { useTranslation } from 'react-i18next'
import type { Locale } from './index'

export function LanguageSwitch() {
  const { i18n, t } = useTranslation()
  const value: Locale = i18n.language.startsWith('zh') ? 'zh-CN' : 'en-US'

  return (
    <Segmented
      size="small"
      value={value}
      aria-label={t('common.language')}
      options={[
        { label: t('common.zh'), value: 'zh-CN' },
        { label: t('common.en'), value: 'en-US' },
      ]}
      onChange={(next) => {
        void i18n.changeLanguage(String(next))
      }}
    />
  )
}
