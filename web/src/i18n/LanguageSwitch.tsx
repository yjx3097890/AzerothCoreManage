import { useTranslation } from 'react-i18next'
import type { Locale } from './index'

export function LanguageSwitch() {
  const { i18n, t } = useTranslation()
  const value: Locale = i18n.language.startsWith('zh') ? 'zh-CN' : 'en-US'

  return (
    <div className="join" role="group" aria-label={t('common.language')}>
      <button
        type="button"
        className={`btn btn-xs join-item ${value === 'zh-CN' ? 'btn-primary' : 'btn-ghost'}`}
        onClick={() => void i18n.changeLanguage('zh-CN')}
      >
        {t('common.zh')}
      </button>
      <button
        type="button"
        className={`btn btn-xs join-item ${value === 'en-US' ? 'btn-primary' : 'btn-ghost'}`}
        onClick={() => void i18n.changeLanguage('en-US')}
      >
        {t('common.en')}
      </button>
    </div>
  )
}
