import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api/client'
import { DataTable, type Column } from '../ui'

type Overview = {
  target: string
  docker_enabled: boolean
  server_info?: {
    version: string
    connected_players: number
    characters_in_world: number
    connection_peak: number
    uptime: string
    update_diff_ms?: number
    mean_ms?: number
    median_ms?: number
    p95_ms?: number
    p99_ms?: number
    max_ms?: number
    raw: string
  }
  server_info_error?: string
  online?: { real_players: number; bots: number; total: number }
  online_error?: string
  containers?: Array<{
    role: string
    name: string
    running: boolean
    found: boolean
    status: string
  }>
  containers_error?: string
}

type Health = {
  api: string
  target: string
  soap: string
  mysql: string
  docker: string
  mysql_playerbots?: string
}

type Container = NonNullable<Overview['containers']>[number]

export function DashboardPage() {
  const { t } = useTranslation()
  const [overview, setOverview] = useState<Overview | null>(null)
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch('/api/health').then((r) => r.json()),
      api<Overview>('/api/v1/dashboard/overview'),
    ])
      .then(([healthBody, ov]) => {
        if (cancelled) return
        setHealth(healthBody.data)
        setOverview(ov)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : t('dashboard.healthFailed'))
      })
    return () => {
      cancelled = true
    }
  }, [t])

  if (error) return <div className="alert alert-error">{error}</div>
  if (!overview || !health) return <span className="loading loading-spinner" />

  const info = overview.server_info

  const containerColumns: Column<Container>[] = [
    { key: 'role', title: t('servers.role'), dataIndex: 'role' },
    { key: 'name', title: t('servers.name'), dataIndex: 'name' },
    {
      key: 'status',
      title: t('servers.status'),
      render: (_, row) =>
        !row.found ? (
          <span className="badge">{t('servers.notFound')}</span>
        ) : row.running ? (
          <span className="badge badge-success">{row.status}</span>
        ) : (
          <span className="badge">{row.status}</span>
        ),
    },
  ]

  return (
    <div>
      <h2 className="text-xl font-semibold">{t('dashboard.title')}</h2>
      <p className="text-base-content/60">{t('dashboard.intro')}</p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4 mt-4">
        <StatCard title={t('dashboard.realPlayers')} value={overview.online?.real_players ?? '-'} />
        <StatCard title={t('dashboard.bots')} value={overview.online?.bots ?? '-'} />
        <StatCard title={t('dashboard.peak')} value={info?.connection_peak ?? '-'} />
      </div>

      <DescList className="mb-4">
        <DescItem label={t('common.target')}>{overview.target}</DescItem>
        <DescItem label={t('dashboard.version')}>
          {info?.version || overview.server_info_error || '-'}
        </DescItem>
        <DescItem label={t('dashboard.uptime')}>{info?.uptime || '-'}</DescItem>
        <DescItem label={t('dashboard.connected')}>{info?.connected_players ?? '-'}</DescItem>
        <DescItem label={t('dashboard.charsInWorld')}>{info?.characters_in_world ?? '-'}</DescItem>
        <DescItem label={t('dashboard.updateDiff')}>{info?.update_diff_ms ?? '-'} ms</DescItem>
        <DescItem label={t('dashboard.lag')}>
          {t('dashboard.lagLine', {
            mean: info?.mean_ms ?? '-',
            median: info?.median_ms ?? '-',
            p95: info?.p95_ms ?? '-',
            max: info?.max_ms ?? '-',
          })}
        </DescItem>
      </DescList>

      <h3 className="text-base font-semibold mb-2">{t('dashboard.health')}</h3>
      <DescList className="mb-4">
        <DescItem label="API">
          <StatusTag value={health.api} />
        </DescItem>
        <DescItem label="SOAP">
          <StatusTag value={health.soap} />
        </DescItem>
        <DescItem label="MySQL">
          <StatusTag value={health.mysql} />
        </DescItem>
        <DescItem label="Docker">
          <StatusTag value={health.docker} />
        </DescItem>
      </DescList>

      {overview.docker_enabled ? (
        <>
          <h3 className="text-base font-semibold mb-2">{t('dashboard.containers')}</h3>
          {overview.containers_error ? (
            <div className="alert alert-warning">{overview.containers_error}</div>
          ) : (
            <DataTable
              rowKey="name"
              size="sm"
              pagination={false}
              dataSource={overview.containers || []}
              columns={containerColumns}
            />
          )}
        </>
      ) : (
        <div className="alert alert-info">{t('dashboard.dockerDisabled')}</div>
      )}
    </div>
  )
}

function StatCard({ title, value }: { title: ReactNode; value: ReactNode }) {
  return (
    <div className="card bg-base-100 border border-base-300">
      <div className="card-body p-4">
        <span className="text-sm text-base-content/60">{title}</span>
        <span className="text-2xl font-semibold">{value}</span>
      </div>
    </div>
  )
}

function DescList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <dl className={`rounded-box border border-base-300 divide-y divide-base-300 ${className ?? ''}`}>
      {children}
    </dl>
  )
}

function DescItem({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr]">
      <dt className="px-3 py-2 text-sm bg-base-200/60 font-medium">{label}</dt>
      <dd className="px-3 py-2 text-sm">{children}</dd>
    </div>
  )
}

function StatusTag({ value }: { value: string }) {
  const { t } = useTranslation()
  const ok = value === 'ok' || value === 'disabled'
  const label =
    value === 'ok'
      ? t('common.statusOk')
      : value === 'disabled'
        ? t('common.statusDisabled')
        : value === 'error'
          ? t('common.statusError')
          : value
  return <span className={`badge ${ok ? 'badge-success' : 'badge-error'}`}>{label}</span>
}
