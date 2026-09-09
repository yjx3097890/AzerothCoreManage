import { Button, Descriptions, Drawer, Form, Input, Space, Switch, Table, Tag, Typography, message } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, errorMessage, hasMinRole } from '../api/client'
import { ConfirmDanger } from '../components/ConfirmDanger'

type Ticket = {
  id: number
  name: string
  description: string
  online: number
  completed: number
  assigned_to: number
  comment: string
  response: string
  map_id: number
  create_time: number
}

export function TicketsPage() {
  const { t } = useTranslation()
  const [items, setItems] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(false)
  const [onlineOnly, setOnlineOnly] = useState(false)
  const [detail, setDetail] = useState<Ticket | null>(null)
  const [pending, setPending] = useState<{ title: string; description: string; run: () => Promise<void> } | null>(null)
  const [commentForm] = Form.useForm()
  const [assignForm] = Form.useForm()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ open: '1' })
      if (onlineOnly) params.set('online', '1')
      const data = await api<{ items: Ticket[] }>(`/api/v1/tickets?${params}`)
      setItems(data.items)
    } catch (err) {
      message.error(errorMessage(err, t))
    } finally {
      setLoading(false)
    }
  }, [onlineOnly, t])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }} wrap>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {t('pages.tickets.title')}
        </Typography.Title>
        <Space wrap>
          <span>{t('tickets.onlineOnly')}</span>
          <Switch checked={onlineOnly} onChange={setOnlineOnly} />
          <Button onClick={() => void load()}>{t('common.refresh')}</Button>
          {hasMinRole('superadmin') && (
            <>
              <Button
                onClick={() =>
                  setPending({
                    title: t('tickets.toggleSystem'),
                    description: t('tickets.toggleConfirm'),
                    run: async () => {
                      await api('/api/v1/tickets/system', {
                        method: 'POST',
                        body: JSON.stringify({ action: 'toggle', confirm: true }),
                      })
                    },
                  })
                }
              >
                {t('tickets.toggleSystem')}
              </Button>
              <Button
                danger
                onClick={() =>
                  setPending({
                    title: t('tickets.reset'),
                    description: t('tickets.resetConfirm'),
                    run: async () => {
                      await api('/api/v1/tickets/system', {
                        method: 'POST',
                        body: JSON.stringify({ action: 'reset', confirm: true }),
                      })
                    },
                  })
                }
              >
                {t('tickets.reset')}
              </Button>
            </>
          )}
        </Space>
      </Space>

      <Table
        loading={loading}
        rowKey="id"
        dataSource={items}
        columns={[
          { title: 'ID', dataIndex: 'id', width: 70 },
          { title: t('characters.name'), dataIndex: 'name' },
          {
            title: t('tickets.description'),
            dataIndex: 'description',
            ellipsis: true,
          },
          {
            title: t('characters.online'),
            dataIndex: 'online',
            width: 80,
            render: (v: number) => (v ? <Tag color="success">{t('common.yes')}</Tag> : t('common.no')),
          },
          {
            title: t('common.actions'),
            render: (_, row) => (
              <Button
                size="small"
                onClick={async () => {
                  try {
                    setDetail(await api<Ticket>(`/api/v1/tickets/${row.id}`))
                  } catch (err) {
                    message.error(errorMessage(err, t))
                  }
                }}
              >
                {t('tickets.detail')}
              </Button>
            ),
          },
        ]}
      />

      <Drawer open={!!detail} width={520} title={`#${detail?.id} ${detail?.name ?? ''}`} onClose={() => setDetail(null)}>
        {detail && (
          <Space direction="vertical" style={{ width: '100%' }} size="large">
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label={t('tickets.description')}>{detail.description}</Descriptions.Item>
              <Descriptions.Item label={t('tickets.comment')}>{detail.comment || '-'}</Descriptions.Item>
              <Descriptions.Item label={t('tickets.response')}>{detail.response || '-'}</Descriptions.Item>
              <Descriptions.Item label={t('characters.map')}>{detail.map_id}</Descriptions.Item>
            </Descriptions>

            {hasMinRole('gm') && (
              <>
                <Form
                  form={commentForm}
                  layout="vertical"
                  onFinish={async (values: { comment: string }) => {
                    try {
                      await api(`/api/v1/tickets/${detail.id}/comment`, {
                        method: 'POST',
                        body: JSON.stringify(values),
                      })
                      message.success(t('common.ok'))
                      commentForm.resetFields()
                      setDetail(await api<Ticket>(`/api/v1/tickets/${detail.id}`))
                    } catch (err) {
                      message.error(errorMessage(err, t))
                    }
                  }}
                >
                  <Form.Item name="comment" label={t('tickets.addComment')} rules={[{ required: true }]}>
                    <Input.TextArea rows={2} />
                  </Form.Item>
                  <Button htmlType="submit">{t('tickets.addComment')}</Button>
                </Form>

                <Form
                  form={assignForm}
                  layout="inline"
                  onFinish={async (values: { gm_name: string }) => {
                    try {
                      await api(`/api/v1/tickets/${detail.id}/assign`, {
                        method: 'POST',
                        body: JSON.stringify({ action: 'assign', gm_name: values.gm_name }),
                      })
                      message.success(t('common.ok'))
                    } catch (err) {
                      message.error(errorMessage(err, t))
                    }
                  }}
                >
                  <Form.Item name="gm_name" rules={[{ required: true }]}>
                    <Input placeholder={t('tickets.gmName')} />
                  </Form.Item>
                  <Button htmlType="submit">{t('tickets.assign')}</Button>
                  <Button
                    onClick={() =>
                      setPending({
                        title: t('tickets.unassign'),
                        description: t('tickets.unassignConfirm', { id: detail.id }),
                        run: async () => {
                          await api(`/api/v1/tickets/${detail.id}/assign`, {
                            method: 'POST',
                            body: JSON.stringify({ action: 'unassign' }),
                          })
                        },
                      })
                    }
                  >
                    {t('tickets.unassign')}
                  </Button>
                </Form>

                <Space wrap>
                  <Button
                    danger
                    onClick={() =>
                      setPending({
                        title: t('tickets.close'),
                        description: t('tickets.closeConfirm', { id: detail.id }),
                        run: async () => {
                          await api(`/api/v1/tickets/${detail.id}/close`, {
                            method: 'POST',
                            body: JSON.stringify({ action: 'close', confirm: true }),
                          })
                          setDetail(null)
                        },
                      })
                    }
                  >
                    {t('tickets.close')}
                  </Button>
                  <Button
                    onClick={() =>
                      setPending({
                        title: t('tickets.complete'),
                        description: t('tickets.completeConfirm', { id: detail.id }),
                        run: async () => {
                          await api(`/api/v1/tickets/${detail.id}/close`, {
                            method: 'POST',
                            body: JSON.stringify({ action: 'complete', confirm: true }),
                          })
                          setDetail(null)
                        },
                      })
                    }
                  >
                    {t('tickets.complete')}
                  </Button>
                  {hasMinRole('superadmin') && (
                    <Button
                      danger
                      onClick={() =>
                        setPending({
                          title: t('tickets.delete'),
                          description: t('tickets.deleteConfirm', { id: detail.id }),
                          run: async () => {
                            await api(`/api/v1/tickets/${detail.id}`, {
                              method: 'DELETE',
                              body: JSON.stringify({ confirm: true }),
                            })
                            setDetail(null)
                          },
                        })
                      }
                    >
                      {t('tickets.delete')}
                    </Button>
                  )}
                </Space>
              </>
            )}
          </Space>
        )}
      </Drawer>

      <ConfirmDanger
        open={!!pending}
        title={pending?.title}
        description={pending?.description}
        onCancel={() => setPending(null)}
        onConfirm={async () => {
          if (!pending) return
          try {
            await pending.run()
            message.success(t('common.ok'))
            setPending(null)
            void load()
          } catch (err) {
            message.error(errorMessage(err, t))
          }
        }}
      />
    </div>
  )
}
