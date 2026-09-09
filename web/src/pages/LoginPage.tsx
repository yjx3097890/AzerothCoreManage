import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api, errorMessage, setSession } from '../api/client'
import { LanguageSwitch } from '../i18n/LanguageSwitch'
import { ThemeSwitch } from '../i18n/ThemeSwitch'
import { toast } from '../ui'

export function LoginPage() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  return (
    <div className="min-h-screen grid place-items-center bg-base-200">
      <div className="card w-96 bg-base-100 shadow-md">
        <div className="card-body">
          <div className="flex items-start justify-between gap-2">
            <h2 className="card-title text-lg">{t('login.title')}</h2>
            <div className="flex items-center gap-1">
              <ThemeSwitch />
              <LanguageSwitch />
            </div>
          </div>
          <form
            className="flex flex-col gap-3 mt-2"
            onSubmit={async (e) => {
              e.preventDefault()
              if (!username.trim() || !password) {
                toast.error(t('validation.required'))
                return
              }
              setLoading(true)
              try {
                const data = await api<{
                  token: string
                  user: { username: string; role: 'readonly' | 'gm' | 'superadmin' }
                }>('/api/v1/auth/login', {
                  method: 'POST',
                  body: JSON.stringify({ username, password }),
                })
                setSession(data.user, data.token)
                navigate('/')
              } catch (err) {
                toast.error(errorMessage(err, t))
              } finally {
                setLoading(false)
              }
            }}
          >
            <label className="form-control w-full">
              <span className="label-text mb-1">{t('login.username')}</span>
              <input
                className="input input-bordered w-full"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
              />
            </label>
            <label className="form-control w-full">
              <span className="label-text mb-1">{t('login.password')}</span>
              <input
                type="password"
                className="input input-bordered w-full"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            <button type="submit" className="btn btn-primary w-full mt-2" disabled={loading}>
              {loading && <span className="loading loading-spinner loading-sm" />}
              {t('common.login')}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
