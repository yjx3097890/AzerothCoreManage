import { Layout, Menu, Button, Space, Tag } from 'antd'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { clearToken, getRole, hasMinRole, type Role } from '../api/client'
import { LanguageSwitch } from '../i18n/LanguageSwitch'

const { Header, Sider, Content } = Layout

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

  const items = useMemo(
    () =>
      NAV.filter((item) => !item.minRole || hasMinRole(item.minRole)).map((item) => ({
        key: item.key,
        label: <Link to={item.key}>{t(item.labelKey)}</Link>,
      })),
    [t, role],
  )

  const selected = items.find((i) => i.key !== '/' && location.pathname.startsWith(i.key))?.key ?? '/'

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider width={220} theme="dark">
        <div style={{ padding: 16, color: '#fff', fontWeight: 600 }}>{t('app.name')}</div>
        <Menu theme="dark" mode="inline" selectedKeys={[selected]} items={items} />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', padding: '0 24px', display: 'flex', alignItems: 'center' }}>
          <Space style={{ marginLeft: 'auto' }}>
            <Tag>
              {role === 'readonly'
                ? t('common.roleReadonly')
                : role === 'gm'
                  ? t('common.roleGm')
                  : role === 'superadmin'
                    ? t('common.roleSuperadmin')
                    : role}
            </Tag>
            <LanguageSwitch />
            <Button
              onClick={() => {
                clearToken()
                navigate('/login')
              }}
            >
              {t('common.logout')}
            </Button>
          </Space>
        </Header>
        <Content style={{ margin: 24, background: '#fff', padding: 24 }}>{children}</Content>
      </Layout>
    </Layout>
  )
}
