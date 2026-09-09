import { Alert, Button, Form, Input, InputNumber, Select, Space, Table, Typography, message } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, errorMessage, hasMinRole } from '../api/client'
import { ConfirmDanger } from '../components/ConfirmDanger'
import { MapSelect } from '../components/PlaceSelect'

type DisableRow = {
  source_type: number
  source_type_name?: string
  entry: number
  entry_name?: string
  flags: number
  flags_text?: string
  params_0: string
  params_1: string
  comment: string
  comment_en?: string
}

type EventRow = {
  id: number
  name: string
  name_en: string
  active: boolean
  raw: string
}

export function EventsPage() {
  const { t, i18n } = useTranslation()
  const [events, setEvents] = useState<EventRow[]>([])
  const [eventsLoading, setEventsLoading] = useState(false)
  const [disables, setDisables] = useState<DisableRow[]>([])
  const [disablesLoading, setDisablesLoading] = useState(false)
  const [pending, setPending] = useState<{ title: string; description: string; run: () => Promise<void> } | null>(null)

  const load = useCallback(async () => {
    setEventsLoading(true)
    try {
      const data = await api<{ items: EventRow[]; raw: string }>('/api/v1/events')
      setEvents(data.items ?? [])
    } catch (err) {
      message.error(errorMessage(err, t))
    } finally {
      setEventsLoading(false)
    }
  }, [t])

  const loadDisables = useCallback(async () => {
    setDisablesLoading(true)
    try {
      const data = await api<{ items: DisableRow[] }>('/api/v1/disables?limit=200')
      setDisables(data.items)
    } catch (err) {
      message.error(errorMessage(err, t))
    } finally {
      setDisablesLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
    void loadDisables()
  }, [load, loadDisables, i18n.language])

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {t('pages.events.title')}
        </Typography.Title>
        <Button
          onClick={() => {
            void load()
            void loadDisables()
          }}
        >
          {t('common.refresh')}
        </Button>
      </Space>
      <Alert type="info" showIcon message={t('events.hint')} style={{ marginBottom: 16 }} />

      <Table
        size="small"
        loading={eventsLoading}
        rowKey="id"
        dataSource={events}
        pagination={false}
        style={{ marginBottom: 16 }}
        columns={[
          { title: t('events.eventId'), dataIndex: 'id', width: 90 },
          { title: t('events.name'), dataIndex: 'name', ellipsis: true },
          {
            title: t('events.status'),
            dataIndex: 'active',
            width: 100,
            render: (v: boolean) => (v ? t('events.active') : t('events.inactive')),
          },
          ...(hasMinRole('gm')
            ? [
                {
                  title: t('common.actions'),
                  key: 'actions',
                  width: 160,
                  render: (_: unknown, row: EventRow) => (
                    <Space>
                      <Button
                        size="small"
                        type="primary"
                        onClick={() =>
                          setPending({
                            title: t('events.action'),
                            description: `${t('common.start')} #${row.id} ${row.name}`,
                            run: async () => {
                              await api('/api/v1/events', {
                                method: 'POST',
                                body: JSON.stringify({ action: 'start', event_id: row.id, confirm: true }),
                              })
                              await load()
                            },
                          })
                        }
                      >
                        {t('common.start')}
                      </Button>
                      <Button
                        size="small"
                        danger
                        onClick={() =>
                          setPending({
                            title: t('events.action'),
                            description: `${t('common.stop')} #${row.id} ${row.name}`,
                            run: async () => {
                              await api('/api/v1/events', {
                                method: 'POST',
                                body: JSON.stringify({ action: 'stop', event_id: row.id, confirm: true }),
                              })
                              await load()
                            },
                          })
                        }
                      >
                        {t('common.stop')}
                      </Button>
                    </Space>
                  ),
                },
              ]
            : []),
        ]}
      />

      {hasMinRole('gm') && (
        <Form
          layout="inline"
          style={{ marginTop: 8, marginBottom: 8 }}
          initialValues={{ action: 'start' }}
          onFinish={(values: { action: string; event_id: number }) => {
            setPending({
              title: t('events.action'),
              description: `${values.action} #${values.event_id}`,
              run: async () => {
                await api('/api/v1/events', {
                  method: 'POST',
                  body: JSON.stringify({ ...values, confirm: true }),
                })
                await load()
              },
            })
          }}
        >
          <Form.Item name="action" rules={[{ required: true }]}>
            <Select
              style={{ width: 120 }}
              options={[
                { value: 'start', label: t('common.start') },
                { value: 'stop', label: t('common.stop') },
              ]}
            />
          </Form.Item>
          <Form.Item name="event_id" rules={[{ required: true }]}>
            <InputNumber min={1} placeholder={t('events.eventId')} />
          </Form.Item>
          <Button type="primary" htmlType="submit">
            {t('events.action')}
          </Button>
        </Form>
      )}

      <Typography.Title level={4} style={{ marginTop: 32 }}>
        {t('events.disables')}
      </Typography.Title>

      {hasMinRole('gm') && (
        <Space direction="vertical" style={{ width: '100%', marginBottom: 16 }} size="middle">
          <Form
            layout="inline"
            initialValues={{ action: 'add', type: 'spell', flag: 0 }}
            onFinish={(values: {
              action: string
              type?: string
              entry?: number
              flag?: number
              comment?: string
            }) => {
              setPending({
                title: t('events.disables'),
                description: t('events.disableConfirm', {
                  action: values.action,
                  type: values.type ?? '',
                  entry: values.entry ?? '',
                }),
                run: async () => {
                  await api('/api/v1/disables', {
                    method: 'POST',
                    body: JSON.stringify({ ...values, confirm: true }),
                  })
                  await loadDisables()
                },
              })
            }}
          >
            <Form.Item name="action" rules={[{ required: true }]}>
              <Select
                style={{ width: 110 }}
                options={[
                  { value: 'add', label: t('common.add') },
                  { value: 'remove', label: t('common.remove') },
                  { value: 'reload', label: t('common.reload') },
                ]}
              />
            </Form.Item>
            <Form.Item noStyle shouldUpdate={(a, b) => a.action !== b.action || a.type !== b.type}>
              {({ getFieldValue }) =>
                getFieldValue('action') === 'reload' ? null : (
                  <>
                    <Form.Item name="type" rules={[{ required: true }]}>
                      <Select
                        style={{ width: 140 }}
                        options={[
                          { value: 'spell', label: t('events.typeSpell') },
                          { value: 'map', label: t('events.typeMap') },
                          { value: 'battleground', label: t('events.typeBattleground') },
                          { value: 'quest', label: t('events.typeQuest') },
                          { value: 'vmap', label: t('events.typeVmap') },
                          { value: 'outdoorpvp', label: t('events.typeOutdoorpvp') },
                        ]}
                      />
                    </Form.Item>
                    <Form.Item name="entry" rules={[{ required: true }]}>
                      {['map', 'vmap', 'battleground'].includes(String(getFieldValue('type'))) ? (
                        <MapSelect style={{ width: 240 }} />
                      ) : (
                        <InputNumber min={1} placeholder={t('common.entry')} />
                      )}
                    </Form.Item>
                    {getFieldValue('action') === 'add' && (
                      <>
                        <Form.Item name="flag">
                          <InputNumber min={0} placeholder={t('accounts.flag')} />
                        </Form.Item>
                        <Form.Item name="comment">
                          <Input placeholder={t('moderation.reason')} style={{ width: 140 }} />
                        </Form.Item>
                      </>
                    )}
                  </>
                )
              }
            </Form.Item>
            <Button htmlType="submit">{t('events.disableAction')}</Button>
          </Form>
        </Space>
      )}

      <Table
        size="small"
        loading={disablesLoading}
        rowKey={(r) => `${r.source_type}-${r.entry}`}
        dataSource={disables}
        pagination={{ pageSize: 20 }}
        columns={[
          {
            title: t('events.sourceType'),
            dataIndex: 'source_type',
            width: 120,
            render: (_: number, r: DisableRow) =>
              r.source_type_name ? `${r.source_type_name} (#${r.source_type})` : r.source_type,
          },
          {
            title: t('common.entry'),
            dataIndex: 'entry',
            width: 220,
            ellipsis: true,
            render: (_: number, r: DisableRow) =>
              r.entry_name ? `${r.entry_name} (#${r.entry})` : `#${r.entry}`,
          },
          {
            title: t('common.flags'),
            dataIndex: 'flags',
            width: 200,
            ellipsis: true,
            render: (_: number, r: DisableRow) =>
              r.flags_text ? `${r.flags_text} (${r.flags})` : r.flags,
          },
          { title: t('common.params0'), dataIndex: 'params_0', ellipsis: true },
          { title: t('common.params1'), dataIndex: 'params_1', ellipsis: true },
          { title: t('moderation.reason'), dataIndex: 'comment', ellipsis: true },
        ]}
      />

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
          } catch (err) {
            message.error(errorMessage(err, t))
          }
        }}
      />
    </div>
  )
}
