import { Link, useLocation, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { clearToken, getRole, hasMinRole, type Role } from '../api/client'
import { LanguageSwitch } from '../i18n/LanguageSwitch'
import { ThemeSwitch } from '../i18n/ThemeSwitch'

type NavItem = {
  key: string
  labelKey: string
  minRole?: Role
}

const NAV: NavItem[] = [
  { key: '/', labelKey: 'nav.dashboard' },
  { key: '/servers', labelKey: 'nav.servers', minRole: 'gm' },
  { key: '/accounts', labelKey: 'nav.accounts' },
  { key: '/characters', labelKey: 'nav.characters' },
  { key: '/moderation', labelKey: 'nav.moderation', minRole: 'gm' },
  { key: '/mail', labelKey: 'nav.mail', minRole: 'gm' },
  { key: '/announcements', labelKey: 'nav.announcements' },
  { key: '/tickets', labelKey: 'nav.tickets' },
  { key: '/guilds', labelKey: 'nav.guilds' },
  { key: '/auctions', labelKey: 'nav.auctions' },
  { key: '/events', labelKey: 'nav.events' },
  { key: '/playerbots', labelKey: 'nav.playerbots' },
  { key: '/logs', labelKey: 'nav.logs', minRole: 'gm' },
  { key: '/config', labelKey: 'nav.config', minRole: 'superadmin' },
  { key: '/sql', labelKey: 'nav.sql', minRole: 'superadmin' },
  { key: '/audit', labelKey: 'nav.audit', minRole: 'gm' },
  { key: '/settings', labelKey: 'nav.settings', minRole: 'superadmin' },
]

export function AdminLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const role = getRole()

  const items = NAV.filter((item) => !item.minRole || hasMinRole(item.minRole))
  const selected = items.find((i) => i.key !== '/' && location.pathname.startsWith(i.key))?.key ?? '/'

  const roleLabel =
    role === 'readonly'
      ? t('common.roleReadonly')
      : role === 'gm'
        ? t('common.roleGm')
        : role === 'superadmin'
          ? t('common.roleSuperadmin')
          : role

  return (
    <div className="min-h-screen flex bg-base-200">
      <aside className="w-[220px] shrink-0 bg-neutral text-neutral-content flex flex-col">
        <div className="p-4 font-semibold text-base">{t('app.name')}</div>
        <ul className="menu menu-sm px-2 pb-4 gap-0.5 flex-1">
          {items.map((item) => (
            <li key={item.key}>
              <Link to={item.key} className={item.key === selected ? 'active' : ''}>
                {t(item.labelKey)}
              </Link>
            </li>
          ))}
        </ul>
      </aside>
      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-base-100 border-b border-base-300 px-6 h-14 flex items-center justify-end gap-3">
          <span className="badge badge-ghost">{roleLabel}</span>
          <ThemeSwitch />
          <LanguageSwitch />
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              clearToken()
              navigate('/login')
            }}
          >
            {t('common.logout')}
          </button>
        </header>
        <main className="m-6 p-6 bg-base-100 rounded-box shadow-sm min-h-[calc(100vh-7rem)]">{children}</main>
      </div>
    </div>
  )
}
