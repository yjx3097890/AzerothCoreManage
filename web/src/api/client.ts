import type { TFunction } from 'i18next'
import { currentLocale } from '../i18n'

export type Role = 'readonly' | 'gm' | 'superadmin'

export type ApiError = Error & { task?: string; code?: string }

export type Envelope<T> = {
  ok: boolean
  data?: T
  task?: string
  error?: { code: string; message: string }
}

const TOKEN_KEY = 'acmanage.token'
const ROLE_KEY = 'acmanage.role'
const USER_KEY = 'acmanage.username'
const TARGET_KEY = 'acmanage.target'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) ?? ''
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(ROLE_KEY)
  localStorage.removeItem(USER_KEY)
}

export function setSession(user: { username: string; role: Role }, token: string) {
  setToken(token)
  localStorage.setItem(ROLE_KEY, user.role)
  localStorage.setItem(USER_KEY, user.username)
}

export function getRole(): Role {
  return (localStorage.getItem(ROLE_KEY) as Role) || 'readonly'
}

export function getTargetId(): string {
  return localStorage.getItem(TARGET_KEY) ?? ''
}

export function setTargetId(id: string) {
  if (id) localStorage.setItem(TARGET_KEY, id)
  else localStorage.removeItem(TARGET_KEY)
}

export function roleRank(role: Role): number {
  switch (role) {
    case 'superadmin':
      return 3
    case 'gm':
      return 2
    default:
      return 1
  }
}

export function hasMinRole(min: Role): boolean {
  return roleRank(getRole()) >= roleRank(min)
}

export function errorMessage(err: unknown, t: TFunction): string {
  if (err && typeof err === 'object' && 'code' in err) {
    const apiErr = err as ApiError
    if (apiErr.code) {
      return t(`errors.${apiErr.code}`, {
        task: apiErr.task,
        defaultValue: apiErr.message || t('login.failed'),
      })
    }
  }
  if (err instanceof Error && err.message) {
    return err.message
  }
  return t('login.failed')
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json')
  }
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  headers.set('X-Locale', currentLocale())
  headers.set('Accept-Language', currentLocale())
  const target = getTargetId()
  if (target) headers.set('X-Target-Id', target)

  const res = await fetch(path, { ...init, headers })
  const body = (await res.json()) as Envelope<T>
  if (!res.ok || !body.ok) {
    const err = new Error(body.error?.message || res.statusText) as ApiError
    err.task = body.task
    err.code = body.error?.code
    if (res.status === 401 && location.pathname !== '/login') {
      clearToken()
      location.href = '/login'
    }
    throw err
  }
  return body.data as T
}
