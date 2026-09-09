import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import enUS from './locales/en-US.json'
import zhCN from './locales/zh-CN.json'

export const locales = ['zh-CN', 'en-US'] as const
export type Locale = (typeof locales)[number]

export const LOCALE_KEY = 'acmanage.locale'

export function detectLocale(): Locale {
  const saved = localStorage.getItem(LOCALE_KEY)
  if (saved === 'zh-CN' || saved === 'en-US') {
    return saved
  }
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US'
}

export function persistLocale(locale: Locale) {
  localStorage.setItem(LOCALE_KEY, locale)
  document.documentElement.lang = locale
}

void i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': { translation: zhCN },
    'en-US': { translation: enUS },
  },
  lng: detectLocale(),
  fallbackLng: 'zh-CN',
  supportedLngs: [...locales],
  interpolation: { escapeValue: false },
})

persistLocale(i18n.language.startsWith('zh') ? 'zh-CN' : 'en-US')
i18n.on('languageChanged', (lng) => {
  persistLocale(lng.startsWith('zh') ? 'zh-CN' : 'en-US')
})

export function currentLocale(): Locale {
  return i18n.language.startsWith('zh') ? 'zh-CN' : 'en-US'
}

export default i18n
