import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { AppLocale } from './i18n/AppLocale'
import { ToastHost } from './ui'
import './i18n'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppLocale>
      <App />
      <ToastHost />
    </AppLocale>
  </StrictMode>,
)
