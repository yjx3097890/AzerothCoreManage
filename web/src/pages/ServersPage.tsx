import { Alert, Button, Form, InputNumber, Modal, Select, Space, Table, Tag, Typography, message } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, errorMessage } from '../api/client'

type ServerItem = {
  role: string
  name: string
  running: boolean
  found: boolean
  status: string
}

type ServersResp = {
  enabled: boolean
  items: ServerItem[]
  message?: string
}

export function ServersPage() {
  const { t } = useTranslation()
  const [data, setData] = useState<ServersResp | null>(null)
  const [loading, setLoading] = useState(false)
  const [lifecycleOpen, setLifecycleOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const resp = await api<ServersResp>('/api/v1/servers')
      setData(resp)
    } catch (err) {
      message.error(errorMessage(err, t))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const act = async (name: string, action: 'start' | 'stop' | 'restart') => {
    try {
      await api(`/api/v1/servers/${encodeURIComponent(name)}/${action}`, { method: 'POST', body: '{}' })
      message.success(t('servers.actionOk'))
      await load()
    } catch (err) {
      message.error(errorMessage(err, t))
    }
  }

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {t('pages.servers.title')}
        </Typography.Title>
        <Space>
          <Button onClick={() => void load()}>{t('common.refresh')}</Button>
          <Button type="primary" danger onClick={() => setLifecycleOpen(true)}>
            {t('servers.lifecycle')}
          </Button>
        </Space>
      </Space>

      {!data ? (
        <Alert type="info" message={t('common.loading')} />
      ) : !data.enabled ? (
        <Alert type="info" showIcon message={t('dashboard.dockerDisabled')} description={data.message} />
      ) : (
        <Table
          loading={loading}
          rowKey="name"
          dataSource={data.items}
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
                  <Tag>{row.status}</Tag>
                ),
            },
            {
              title: t('common.actions'),
              render: (_, row) => (
                <Space>
                  <Button size="small" disabled={!row.found || row.running} onClick={() => void act(row.name, 'start')}>
                    {t('servers.start')}
                  </Button>
                  <Button size="small" disabled={!row.found || !row.running} onClick={() => void act(row.name, 'stop')}>
                    {t('servers.stop')}
                  </Button>
                  <Button size="small" disabled={!row.found} onClick={() => void act(row.name, 'restart')}>
                    {t('servers.restart')}
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      )}

      <LifecycleModal
        open={lifecycleOpen}
        onClose={() => setLifecycleOpen(false)}
        onDone={() => {
          setLifecycleOpen(false)
          void load()
        }}
      />
    </div>
  )
}

function LifecycleModal({
  open,
  onClose,
  onDone,
}: {
  open: boolean
  onClose: () => void
  onDone: () => void
}) {
  const { t } = useTranslation()
  const [form] = Form.useForm()

  return (
    <Modal
      open={open}
      title={t('servers.lifecycle')}
      onCancel={onClose}
      onOk={() => {
        form.submit()
      }}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ delay: 30 }}
        onFinish={async (values: { action: string; delay: number }) => {
          try {
            await api('/api/v1/servers/lifecycle', {
              method: 'POST',
              body: JSON.stringify({
                action: values.action,
                delay: values.delay,
                confirm: values.action === 'restart' || values.action === 'shutdown',
              }),
            })
            message.success(t('servers.actionOk'))
            onDone()
          } catch (err) {
            message.error(errorMessage(err, t))
          }
        }}
      >
        <Form.Item name="action" label={t('servers.action')} rules={[{ required: true }]}>
          <Select
            options={[
              { value: 'restart', label: t('servers.soapRestart') },
              { value: 'shutdown', label: t('servers.soapShutdown') },
              { value: 'restart_cancel', label: t('servers.cancelRestart') },
              { value: 'shutdown_cancel', label: t('servers.cancelShutdown') },
            ]}
          />
        </Form.Item>
        <Form.Item name="delay" label={t('servers.delaySeconds')}>
          <InputNumber min={1} max={3600} style={{ width: '100%' }} />
        </Form.Item>
        <Alert type="warning" showIcon message={t('servers.lifecycleHint')} />
      </Form>
    </Modal>
  )
}
