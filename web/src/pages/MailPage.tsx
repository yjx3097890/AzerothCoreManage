import { Alert, Button, Form, Input, InputNumber, Select, Space, Table, Tabs, Typography, message } from 'antd'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, errorMessage, hasMinRole } from '../api/client'
import { ConfirmDanger } from '../components/ConfirmDanger'
import { ItemSelect } from '../components/ItemSelect'

type MailItemRow = { item_id?: number; count?: number }

type MailForm = {
  mode: string
  player: string
  subject: string
  body: string
  item_id?: number
  count?: number
  items?: MailItemRow[]
  money?: string
}

type BulkForm = MailForm & { playersText: string; delay_ms?: number }

type MailRow = {
  id: number
  sender_name: string
  subject: string
  body: string
  money: number
  has_items: boolean
  deliver_time?: string
  expire_time?: string
  items: Array<{ item_entry: number; count: number; name: string }>
}

function moneyStr(copper: number) {
  const g = Math.floor(copper / 10000)
  const s = Math.floor((copper % 10000) / 100)
  const c = copper % 100
  return `${g}g ${s}s ${c}c`
}

export function MailPage() {
  const { t } = useTranslation()
  const [sendForm] = Form.useForm<MailForm>()
  const [bulkForm] = Form.useForm<BulkForm>()
  const [pending, setPending] = useState<{ kind: 'send' | 'bulk' | 'delete'; payload: unknown; desc: string } | null>(
    null,
  )
  const mode = Form.useWatch('mode', sendForm)
  const bulkMode = Form.useWatch('mode', bulkForm)

  const [playerQ, setPlayerQ] = useState('')
  const [mailLoading, setMailLoading] = useState(false)
  const [online, setOnline] = useState<number | null>(null)
  const [mails, setMails] = useState<MailRow[]>([])

  const loadMails = useCallback(async () => {
    const name = playerQ.trim()
    if (!name) return
    setMailLoading(true)
    try {
      const data = await api<{ items: MailRow[]; online: number }>(
        `/api/v1/mail?player=${encodeURIComponent(name)}&limit=50`,
      )
      setMails(data.items)
      setOnline(data.online)
    } catch (err) {
      message.error(errorMessage(err, t))
      setMails([])
      setOnline(null)
    } finally {
      setMailLoading(false)
    }
  }, [playerQ, t])

  const buildSendBody = (values: MailForm) => {
    const items = (values.items ?? [])
      .filter((i) => i.item_id && i.item_id > 0)
      .map((i) => ({ item_id: i.item_id!, count: i.count || 1 }))
    return {
      mode: values.mode,
      player: values.player,
      subject: values.subject,
      body: values.body || '',
      item_id: values.item_id,
      count: values.count,
      items,
      money: values.money,
      confirm: true,
    }
  }

  return (
    <div>
      <Typography.Title level={3}>{t('pages.mail.title')}</Typography.Title>
      <Tabs
        items={[
          {
            key: 'send',
            label: t('mail.tabSend'),
            children: (
              <div style={{ maxWidth: 640 }}>
                <Form
                  form={sendForm}
                  layout="vertical"
                  initialValues={{ mode: 'mail', count: 1, subject: 'GM', body: '', items: [{ item_id: undefined, count: 1 }] }}
                  onFinish={(values) =>
                    setPending({
                      kind: 'send',
                      payload: buildSendBody(values),
                      desc: t('mail.sendConfirm', { player: values.player, mode: values.mode }),
                    })
                  }
                >
                  <Form.Item name="mode" label={t('mail.mode')} rules={[{ required: true }]}>
                    <Select
                      options={[
                        { value: 'mail', label: t('mail.modeMail') },
                        { value: 'items', label: t('mail.modeItems') },
                        { value: 'money', label: t('mail.modeMoney') },
                        { value: 'both', label: t('mail.modeBoth') },
                      ]}
                    />
                  </Form.Item>
                  <Form.Item name="player" label={t('characters.name')} rules={[{ required: true }]}>
                    <Input />
                  </Form.Item>
                  <Form.Item name="subject" label={t('mail.subject')} rules={[{ required: true }]}>
                    <Input maxLength={64} />
                  </Form.Item>
                  <Form.Item name="body" label={t('mail.body')}>
                    <Input.TextArea rows={3} maxLength={500} />
                  </Form.Item>
                  {(mode === 'items' || mode === 'both') && (
                    <>
                      <Form.List name="items">
                        {(fields, { add, remove }) => (
                          <>
                            {fields.map((field) => (
                              <Space key={field.key} align="baseline" style={{ display: 'flex', marginBottom: 8 }}>
                                <Form.Item
                                  {...field}
                                  name={[field.name, 'item_id']}
                                  label={t('mail.itemId')}
                                  rules={[{ required: true }]}
                                >
                                  <ItemSelect style={{ width: 280 }} />
                                </Form.Item>
                                <Form.Item
                                  {...field}
                                  name={[field.name, 'count']}
                                  label={t('mail.count')}
                                  rules={[{ required: true }]}
                                >
                                  <InputNumber min={1} max={1000} style={{ width: 100 }} />
                                </Form.Item>
                                {fields.length > 1 && (
                                  <Button type="link" danger onClick={() => remove(field.name)}>
                                    {t('common.remove')}
                                  </Button>
                                )}
                              </Space>
                            ))}
                            {fields.length < 12 && (
                              <Button type="dashed" onClick={() => add({ count: 1 })} style={{ marginBottom: 12 }}>
                                {t('mail.addItem')}
                              </Button>
                            )}
                          </>
                        )}
                      </Form.List>
                    </>
                  )}
                  {(mode === 'money' || mode === 'both') && (
                    <Form.Item name="money" label={t('mail.money')} rules={[{ required: true }]} extra="1g2s3c">
                      <Input placeholder="1g2s3c" />
                    </Form.Item>
                  )}
                  <Form.Item>
                    <Button type="primary" htmlType="submit" disabled={!hasMinRole('gm')}>
                      {t('mail.send')}
                    </Button>
                  </Form.Item>
                </Form>
              </div>
            ),
          },
          {
            key: 'bulk',
            label: t('mail.tabBulk'),
            children: (
              <div style={{ maxWidth: 640 }}>
                <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={t('mail.bulkHint')} />
                <Form
                  form={bulkForm}
                  layout="vertical"
                  initialValues={{
                    mode: 'mail',
                    count: 1,
                    subject: 'GM',
                    body: '',
                    delay_ms: 150,
                    items: [{ count: 1 }],
                  }}
                  onFinish={(values) => {
                    const players = values.playersText
                      .split(/[\n,;]+/)
                      .map((s) => s.trim())
                      .filter(Boolean)
                    setPending({
                      kind: 'bulk',
                      payload: {
                        ...buildSendBody({ ...values, player: players[0] || '' }),
                        players,
                        delay_ms: values.delay_ms,
                      },
                      desc: t('mail.bulkConfirm', { count: players.length, mode: values.mode }),
                    })
                  }}
                >
                  <Form.Item name="mode" label={t('mail.mode')} rules={[{ required: true }]}>
                    <Select
                      options={[
                        { value: 'mail', label: t('mail.modeMail') },
                        { value: 'items', label: t('mail.modeItems') },
                        { value: 'money', label: t('mail.modeMoney') },
                        { value: 'both', label: t('mail.modeBoth') },
                      ]}
                    />
                  </Form.Item>
                  <Form.Item name="playersText" label={t('mail.players')} rules={[{ required: true }]} extra={t('mail.playersHint')}>
                    <Input.TextArea rows={5} placeholder={t('mail.playersPlaceholder')} />
                  </Form.Item>
                  <Form.Item name="subject" label={t('mail.subject')} rules={[{ required: true }]}>
                    <Input maxLength={64} />
                  </Form.Item>
                  <Form.Item name="body" label={t('mail.body')}>
                    <Input.TextArea rows={3} maxLength={500} />
                  </Form.Item>
                  {(bulkMode === 'items' || bulkMode === 'both') && (
                    <Form.List name="items">
                      {(fields, { add, remove }) => (
                        <>
                          {fields.map((field) => (
                            <Space key={field.key} align="baseline" style={{ display: 'flex', marginBottom: 8 }}>
                              <Form.Item
                                {...field}
                                name={[field.name, 'item_id']}
                                label={t('mail.itemId')}
                                rules={[{ required: true }]}
                              >
                                <ItemSelect style={{ width: 280 }} />
                              </Form.Item>
                              <Form.Item
                                {...field}
                                name={[field.name, 'count']}
                                label={t('mail.count')}
                                rules={[{ required: true }]}
                              >
                                <InputNumber min={1} max={1000} style={{ width: 100 }} />
                              </Form.Item>
                              {fields.length > 1 && (
                                <Button type="link" danger onClick={() => remove(field.name)}>
                                  {t('common.remove')}
                                </Button>
                              )}
                            </Space>
                          ))}
                          {fields.length < 12 && (
                            <Button type="dashed" onClick={() => add({ count: 1 })} style={{ marginBottom: 12 }}>
                              {t('mail.addItem')}
                            </Button>
                          )}
                        </>
                      )}
                    </Form.List>
                  )}
                  {(bulkMode === 'money' || bulkMode === 'both') && (
                    <Form.Item name="money" label={t('mail.money')} rules={[{ required: true }]} extra="1g2s3c">
                      <Input placeholder="1g2s3c" />
                    </Form.Item>
                  )}
                  <Form.Item name="delay_ms" label={t('mail.delayMs')}>
                    <InputNumber min={50} max={2000} style={{ width: 160 }} />
                  </Form.Item>
                  <Form.Item>
                    <Button type="primary" htmlType="submit" disabled={!hasMinRole('gm')}>
                      {t('mail.bulkSend')}
                    </Button>
                  </Form.Item>
                </Form>
              </div>
            ),
          },
          {
            key: 'inbox',
            label: t('mail.tabInbox'),
            children: (
              <div>
                <Space style={{ marginBottom: 12 }} wrap>
                  <Input
                    style={{ width: 220 }}
                    placeholder={t('characters.name')}
                    value={playerQ}
                    onChange={(e) => setPlayerQ(e.target.value)}
                    onPressEnter={() => void loadMails()}
                  />
                  <Button type="primary" loading={mailLoading} onClick={() => void loadMails()}>
                    {t('common.search')}
                  </Button>
                  {online !== null && (
                    <Alert
                      type={online ? 'warning' : 'success'}
                      showIcon
                      message={online ? t('mail.receiverOnline') : t('mail.receiverOffline')}
                    />
                  )}
                </Space>
                <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t('mail.inboxHint')} />
                <Table
                  rowKey="id"
                  size="small"
                  loading={mailLoading}
                  dataSource={mails}
                  pagination={false}
                  expandable={{
                    expandedRowRender: (row) => (
                      <div>
                        <Typography.Paragraph>{row.body || '-'}</Typography.Paragraph>
                        {row.items?.length > 0 && (
                          <ul>
                            {row.items.map((it) => (
                              <li key={`${row.id}-${it.item_entry}-${it.count}`}>
                                [{it.item_entry}] {it.name || '-'} × {it.count}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ),
                  }}
                  columns={[
                    { title: 'ID', dataIndex: 'id', width: 80 },
                    { title: t('mail.sender'), dataIndex: 'sender_name', width: 120 },
                    { title: t('mail.subject'), dataIndex: 'subject', ellipsis: true },
                    {
                      title: t('mail.money'),
                      dataIndex: 'money',
                      width: 120,
                      render: (v: number) => moneyStr(v || 0),
                    },
                    {
                      title: t('mail.items'),
                      dataIndex: 'has_items',
                      width: 80,
                      render: (v: boolean) => (v ? t('common.yes') : t('common.no')),
                    },
                    {
                      title: t('common.actions'),
                      width: 100,
                      render: (_: unknown, row: MailRow) =>
                        hasMinRole('gm') ? (
                          <Button
                            danger
                            size="small"
                            disabled={!!online}
                            onClick={() =>
                              setPending({
                                kind: 'delete',
                                payload: { id: row.id },
                                desc: t('mail.deleteConfirm', { id: row.id, player: playerQ }),
                              })
                            }
                          >
                            {t('common.delete')}
                          </Button>
                        ) : null,
                    },
                  ]}
                />
              </div>
            ),
          },
        ]}
      />

      <ConfirmDanger
        open={!!pending}
        description={pending?.desc}
        onCancel={() => setPending(null)}
        onConfirm={async () => {
          if (!pending) return
          try {
            if (pending.kind === 'send') {
              await api('/api/v1/mail/send', { method: 'POST', body: JSON.stringify(pending.payload) })
              message.success(t('common.ok'))
              sendForm.resetFields(['player', 'body', 'money'])
            } else if (pending.kind === 'bulk') {
              const data = await api<{ total: number; ok: number }>('/api/v1/mail/bulk', {
                method: 'POST',
                body: JSON.stringify(pending.payload),
              })
              message.success(t('mail.bulkResult', { ok: data.ok, total: data.total }))
            } else {
              const { id } = pending.payload as { id: number }
              await api(`/api/v1/mail/${id}`, { method: 'DELETE', body: JSON.stringify({ confirm: true }) })
              message.success(t('common.ok'))
              void loadMails()
            }
            setPending(null)
          } catch (err) {
            message.error(errorMessage(err, t))
          }
        }}
      />
    </div>
  )
}
