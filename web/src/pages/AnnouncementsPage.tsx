import { Button, Form, Input, InputNumber, Select, Space, Table, Typography, message } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, errorMessage, hasMinRole } from '../api/client'
import { ConfirmDanger } from '../components/ConfirmDanger'

type Broadcast = { id: number; text: string; weight: number }

const MOTD_LOCALES = [
  { value: 'zhCN', label: 'zhCN（简体中文）' },
  { value: 'enUS', label: 'enUS（English）' },
  { value: 'zhTW', label: 'zhTW（繁體中文）' },
  { value: 'koKR', label: 'koKR' },
  { value: 'frFR', label: 'frFR' },
  { value: 'deDE', label: 'deDE' },
  { value: 'esES', label: 'esES' },
  { value: 'esMX', label: 'esMX' },
  { value: 'ruRU', label: 'ruRU' },
]

export function AnnouncementsPage() {
  const { t, i18n } = useTranslation()
  const [motdByLocale, setMotdByLocale] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [announceForm] = Form.useForm()
  const [motdForm] = Form.useForm()
  const [createForm] = Form.useForm()
  const [pendingMotd, setPendingMotd] = useState<{ message: string; locale: string } | null>(null)
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([])
  const [broadcastLoading, setBroadcastLoading] = useState(false)
  const [pending, setPending] = useState<{ title: string; description: string; run: () => Promise<void> } | null>(
    null,
  )

  const defaultMotdLocale = i18n.language.startsWith('zh') ? 'zhCN' : 'enUS'

  const applyMotdLocale = useCallback(
    (locale: string, byLocale: Record<string, string>) => {
      motdForm.setFieldsValue({
        locale,
        message: byLocale[locale] ?? '',
      })
    },
    [motdForm],
  )

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api<{ motd: string; by_locale?: Record<string, string> }>('/api/v1/motd')
      const byLocale = data.by_locale ?? {}
      setMotdByLocale(byLocale)
      const locale = (motdForm.getFieldValue('locale') as string) || defaultMotdLocale
      applyMotdLocale(locale, byLocale)
    } catch (err) {
      message.error(errorMessage(err, t))
    } finally {
      setLoading(false)
    }
  }, [applyMotdLocale, defaultMotdLocale, motdForm, t])

  const loadBroadcast = useCallback(async () => {
    setBroadcastLoading(true)
    try {
      const data = await api<{ items: Broadcast[] }>('/api/v1/autobroadcast')
      setBroadcasts(data.items)
    } catch {
      setBroadcasts([])
    } finally {
      setBroadcastLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    void loadBroadcast()
  }, [load, loadBroadcast])

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {t('pages.announcements.title')}
        </Typography.Title>
        <Button
          onClick={() => {
            void load()
            void loadBroadcast()
          }}
          loading={loading}
        >
          {t('common.refresh')}
        </Button>
      </Space>

      {hasMinRole('gm') && (
        <Space direction="vertical" size="large" style={{ width: '100%', maxWidth: 640 }}>
          <Form
            form={announceForm}
            layout="vertical"
            initialValues={{ type: 'announce' }}
            onFinish={async (values: { type: string; message: string }) => {
              try {
                await api('/api/v1/announce', { method: 'POST', body: JSON.stringify(values) })
                message.success(t('common.ok'))
                announceForm.resetFields(['message'])
              } catch (err) {
                message.error(errorMessage(err, t))
              }
            }}
          >
            <Typography.Title level={5}>{t('announcements.send')}</Typography.Title>
            <Form.Item name="type" label={t('announcements.type')} rules={[{ required: true }]}>
              <Select
                options={[
                  { value: 'announce', label: t('announcements.typeAnnounce') },
                  { value: 'notify', label: t('announcements.typeNotify') },
                ]}
              />
            </Form.Item>
            <Form.Item name="message" label={t('announcements.message')} rules={[{ required: true }]}>
              <Input.TextArea rows={3} maxLength={255} />
            </Form.Item>
            <Button type="primary" htmlType="submit">
              {t('announcements.send')}
            </Button>
          </Form>

          <Form
            form={motdForm}
            layout="vertical"
            initialValues={{ locale: defaultMotdLocale }}
            onFinish={(values: { message: string; locale: string }) =>
              setPendingMotd({
                message: values.message ?? '',
                locale: values.locale || defaultMotdLocale,
              })
            }
          >
            <Typography.Title level={5}>{t('announcements.setMotd')}</Typography.Title>
            <Form.Item
              name="locale"
              label={t('announcements.motdLocale')}
              rules={[{ required: true }]}
              extra={t('announcements.motdLocaleHint')}
            >
              <Select
                options={MOTD_LOCALES}
                onChange={(locale: string) => applyMotdLocale(locale, motdByLocale)}
              />
            </Form.Item>
            <Form.Item name="message" label={t('announcements.motdLabel')} rules={[{ required: true }]}>
              <Input.TextArea rows={3} maxLength={255} placeholder={t('announcements.motdEmpty')} />
            </Form.Item>
            <Button htmlType="submit">{t('announcements.setMotd')}</Button>
          </Form>
        </Space>
      )}

      <ConfirmDanger
        open={pendingMotd !== null}
        description={t('announcements.motdConfirm', {
          locale: pendingMotd?.locale ?? '',
        })}
        onCancel={() => setPendingMotd(null)}
        onConfirm={async () => {
          if (!pendingMotd) return
          try {
            await api('/api/v1/motd', {
              method: 'POST',
              body: JSON.stringify({
                message: pendingMotd.message,
                locale: pendingMotd.locale,
                confirm: true,
              }),
            })
            message.success(t('common.ok'))
            setPendingMotd(null)
            void load()
          } catch (err) {
            message.error(errorMessage(err, t))
          }
        }}
      />

      <Typography.Title level={5} style={{ marginTop: 24 }}>
        {t('announcements.autobroadcast')}
      </Typography.Title>

      {hasMinRole('gm') && (
        <Form
          form={createForm}
          layout="inline"
          style={{ marginBottom: 16 }}
          initialValues={{ weight: 1, realmid: -1 }}
          onFinish={(values: { text: string; weight: number; realmid: number }) => {
            setPending({
              title: t('announcements.createBroadcast'),
              description: t('announcements.createBroadcastConfirm'),
              run: async () => {
                await api('/api/v1/autobroadcast', {
                  method: 'POST',
                  body: JSON.stringify({ ...values, confirm: true }),
                })
                createForm.resetFields(['text'])
                await loadBroadcast()
              },
            })
          }}
        >
          <Form.Item name="text" rules={[{ required: true }]}>
            <Input.TextArea rows={1} placeholder={t('announcements.message')} style={{ width: 280 }} />
          </Form.Item>
          <Form.Item name="weight" rules={[{ required: true }]}>
            <InputNumber min={1} placeholder={t('announcements.weight')} />
          </Form.Item>
          <Form.Item name="realmid">
            <InputNumber placeholder={t('announcements.realmId')} />
          </Form.Item>
          <Button type="primary" htmlType="submit">
            {t('announcements.createBroadcast')}
          </Button>
        </Form>
      )}

      <Table
        size="small"
        rowKey="id"
        loading={broadcastLoading}
        dataSource={broadcasts}
        columns={[
          { title: 'ID', dataIndex: 'id', width: 70 },
          { title: t('announcements.message'), dataIndex: 'text' },
          { title: t('announcements.weight'), dataIndex: 'weight', width: 90 },
          {
            title: t('common.actions'),
            width: 100,
            render: (_, row) =>
              hasMinRole('gm') ? (
                <Button
                  size="small"
                  danger
                  onClick={() =>
                    setPending({
                      title: t('announcements.deleteBroadcast'),
                      description: t('announcements.deleteBroadcastConfirm', { id: row.id }),
                      run: async () => {
                        await api(`/api/v1/autobroadcast/${row.id}`, {
                          method: 'DELETE',
                          body: JSON.stringify({ confirm: true }),
                        })
                        await loadBroadcast()
                      },
                    })
                  }
                >
                  {t('common.delete')}
                </Button>
              ) : null,
          },
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
