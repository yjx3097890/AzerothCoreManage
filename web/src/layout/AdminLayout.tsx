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

type NavGroup = {
  labelKey: string
  items: NavItem[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    labelKey: 'nav.groupOverview',
    items: [{ key: '/', labelKey: 'nav.dashboard' }],
  },
  {
    labelKey: 'nav.groupPlayers',
    items: [
      { key: '/accounts', labelKey: 'nav.accounts' },
      { key: '/characters', labelKey: 'nav.characters' },
      { key: '/moderation', labelKey: 'nav.moderation', minRole: 'gm' },
      { key: '/mail', labelKey: 'nav.mail', minRole: 'gm' },
      { key: '/tickets', labelKey: 'nav.tickets' },
    ],
  },
  {
    labelKey: 'nav.groupWorld',
    items: [
      { key: '/announcements', labelKey: 'nav.announcements' },
      { key: '/guilds', labelKey: 'nav.guilds' },
      { key: '/auctions', labelKey: 'nav.auctions' },
      { key: '/events', labelKey: 'nav.events' },
    ],
  },
  {
    labelKey: 'nav.groupExt',
    items: [
      { key: '/playerbots', labelKey: 'nav.playerbots' },
      { key: '/mybots', labelKey: 'nav.mybots' },
      { key: '/modules', labelKey: 'nav.modules', minRole: 'gm' },
    ],
  },
  {
    labelKey: 'nav.groupOps',
    items: [
      { key: '/servers', labelKey: 'nav.servers', minRole: 'gm' },
      { key: '/config', labelKey: 'nav.config', minRole: 'superadmin' },
      { key: '/sql', labelKey: 'nav.sql', minRole: 'superadmin' },
      { key: '/audit', labelKey: 'nav.audit', minRole: 'gm' },
      { key: '/settings', labelKey: 'nav.settings', minRole: 'superadmin' },
    ],
  },
]

export function AdminLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const role = getRole()

  const groups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((item) => !item.minRole || hasMinRole(item.minRole)),
  })).filter((g) => g.items.length > 0)

  const flat = groups.flatMap((g) => g.items)
  const selected = flat.find((i) => i.key !== '/' && location.pathname.startsWith(i.key))?.key ?? '/'

  const roleLabel =
    role === 'readonly'
      ? t('common.roleReadonly')
      : role === 'gm'
        ? t('common.roleGm')
        : role === 'superadmin'
          ? t('common.roleSuperadmin')
          : role

  return (
    <div className="h-screen overflow-hidden flex bg-base-200">
      <aside className="w-[220px] shrink-0 h-full overflow-y-auto bg-neutral text-neutral-content flex flex-col">
        <div className="p-4 font-semibold text-base sticky top-0 bg-neutral z-10 border-b border-neutral-content/10">
          {t('app.name')}
        </div>
        <ul className="menu menu-sm px-2 py-3 gap-0.5 flex-1">
          {groups.map((group) => (
            <li key={group.labelKey} className="menu-group">
              <h2 className="menu-title px-3 pt-3 pb-1 first:pt-1 text-[11px] uppercase tracking-wide text-neutral-content/45 font-medium">
                {t(group.labelKey)}
              </h2>
              <ul className="m-0">
                {group.items.map((item) => (
                  <li key={item.key}>
                    <Link to={item.key} className={item.key === selected ? 'active' : ''}>
                      {t(item.labelKey)}
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </aside>
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <header className="shrink-0 bg-base-100 border-b border-base-300 px-6 h-14 flex items-center justify-end gap-3">
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
        <div className="flex-1 min-h-0 overflow-y-auto">
          <main className="m-6 p-6 bg-base-100 rounded-box shadow-sm min-h-[calc(100%-3rem)]">{children}</main>
        </div>
      </div>
    </div>
  )
}
