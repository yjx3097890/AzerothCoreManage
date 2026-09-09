import { Alert, Card, Col, Descriptions, Row, Spin, Statistic, Table, Tag, Typography } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api/client'

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

  if (error) return <Alert type="error" message={error} />
  if (!overview || !health) return <Spin />

  const info = overview.server_info

  return (
    <div>
      <Typography.Title level={3}>{t('dashboard.title')}</Typography.Title>
      <Typography.Paragraph type="secondary">{t('dashboard.intro')}</Typography.Paragraph>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic title={t('dashboard.realPlayers')} value={overview.online?.real_players ?? '-'} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic title={t('dashboard.bots')} value={overview.online?.bots ?? '-'} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic title={t('dashboard.peak')} value={info?.connection_peak ?? '-'} />
          </Card>
        </Col>
      </Row>

      <Descriptions bordered size="small" column={1} style={{ marginBottom: 16 }}>
        <Descriptions.Item label={t('common.target')}>{overview.target}</Descriptions.Item>
        <Descriptions.Item label={t('dashboard.version')}>{info?.version || overview.server_info_error || '-'}</Descriptions.Item>
        <Descriptions.Item label={t('dashboard.uptime')}>{info?.uptime || '-'}</Descriptions.Item>
        <Descriptions.Item label={t('dashboard.connected')}>{info?.connected_players ?? '-'}</Descriptions.Item>
        <Descriptions.Item label={t('dashboard.charsInWorld')}>{info?.characters_in_world ?? '-'}</Descriptions.Item>
        <Descriptions.Item label={t('dashboard.updateDiff')}>{info?.update_diff_ms ?? '-'} ms</Descriptions.Item>
        <Descriptions.Item label={t('dashboard.lag')}>
          {t('dashboard.lagLine', {
            mean: info?.mean_ms ?? '-',
            median: info?.median_ms ?? '-',
            p95: info?.p95_ms ?? '-',
            max: info?.max_ms ?? '-',
          })}
        </Descriptions.Item>
      </Descriptions>

      <Typography.Title level={5}>{t('dashboard.health')}</Typography.Title>
      <Descriptions bordered size="small" column={1} style={{ marginBottom: 16 }}>
        <Descriptions.Item label="API">
          <StatusTag value={health.api} />
        </Descriptions.Item>
        <Descriptions.Item label="SOAP">
          <StatusTag value={health.soap} />
        </Descriptions.Item>
        <Descriptions.Item label="MySQL">
          <StatusTag value={health.mysql} />
        </Descriptions.Item>
        <Descriptions.Item label="Docker">
          <StatusTag value={health.docker} />
        </Descriptions.Item>
      </Descriptions>

      {overview.docker_enabled ? (
        <>
          <Typography.Title level={5}>{t('dashboard.containers')}</Typography.Title>
          {overview.containers_error ? (
            <Alert type="warning" message={overview.containers_error} />
          ) : (
            <Table
              rowKey="name"
              size="small"
              pagination={false}
              dataSource={overview.containers || []}
              columns={[
                { title: t('servers.role'), dataIndex: 'role' },
                { title: t('servers.name'), dataIndex: 'name' },
                {
                  title: t('servers.status'),
                  render: (_, row) =>
                    !row.found ? (
                      <Tag>{t('servers.notFound')}</Tag>
                    ) : row.running ? (
                      <Tag color="success">{row.status}</Tag>
                    ) : (
                      <Tag color="default">{row.status}</Tag>
                    ),
                },
              ]}
            />
          )}
        </>
      ) : (
        <Alert type="info" showIcon message={t('dashboard.dockerDisabled')} />
      )}
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
  return <Tag color={ok ? 'success' : 'error'}>{label}</Tag>
}
