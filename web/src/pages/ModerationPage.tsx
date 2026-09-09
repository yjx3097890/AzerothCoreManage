import { Button, Form, Input, Modal, Select, Space, Table, Tabs, Typography, message } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, errorMessage, hasMinRole } from '../api/client'
import { ConfirmDanger } from '../components/ConfirmDanger'

type BanLists = {
  account?: Array<Record<string, unknown>>
  ip?: Array<Record<string, unknown>>
  character?: Array<Record<string, unknown>>
}

type LoginLogs = {
  failed_logins: Array<Record<string, unknown>>
  ip_actions: Array<Record<string, unknown>>
}

type FilterKind = 'chat_filter' | 'reserved_name' | 'profanity_name'

export function ModerationPage() {
  const { t } = useTranslation()
  const [tab, setTab] = useState('bans')
  const [data, setData] = useState<BanLists | null>(null)
  const [loading, setLoading] = useState(false)
  const [banOpen, setBanOpen] = useState(false)
  const [muteOpen, setMuteOpen] = useState(false)
  const [freezeOpen, setFreezeOpen] = useState(false)
  const [pending, setPending] = useState<{
    title: string
    description: string
    run: () => Promise<void>
  } | null>(null)

  const [logs, setLogs] = useState<LoginLogs | null>(null)
  const [logsLoading, setLogsLoading] = useState(false)
  const [logAccount, setLogAccount] = useState('')
  const [logIp, setLogIp] = useState('')

  const [filterKind, setFilterKind] = useState<FilterKind>('chat_filter')
  const [filters, setFilters] = useState<Array<Record<string, unknown>>>([])
  const [filtersLoading, setFiltersLoading] = useState(false)
  const [filterValue, setFilterValue] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await api<BanLists>('/api/v1/moderation/bans'))
    } catch (err) {
      message.error(errorMessage(err, t))
    } finally {
      setLoading(false)
    }
  }, [t])

  const loadLogs = useCallback(async () => {
    setLogsLoading(true)
    try {
      const params = new URLSearchParams({ limit: '100' })
      if (logAccount.trim()) params.set('account', logAccount.trim())
      if (logIp.trim()) params.set('ip', logIp.trim())
      setLogs(await api<LoginLogs>(`/api/v1/moderation/login-logs?${params}`))
    } catch (err) {
      message.error(errorMessage(err, t))
    } finally {
      setLogsLoading(false)
    }
  }, [logAccount, logIp, t])

  const loadFilters = useCallback(async () => {
    setFiltersLoading(true)
    try {
      const data = await api<{ items: Array<Record<string, unknown>> }>(
        `/api/v1/moderation/filters?kind=${filterKind}`,
      )
      setFilters(data.items ?? [])
    } catch (err) {
      message.error(errorMessage(err, t))
      setFilters([])
    } finally {
      setFiltersLoading(false)
    }
  }, [filterKind, t])

  useEffect(() => {
    if (tab === 'bans') void load()
    if (tab === 'loginLogs') void loadLogs()
    if (tab === 'filters') void loadFilters()
  }, [tab, load, loadLogs, loadFilters])

  const fmtTime = (v: unknown) => (typeof v === 'string' ? new Date(v).toLocaleString() : '-')

  const mutateFilter = (action: 'add' | 'remove', value: string) => {
    setPending({
      title: t('moderation.filters'),
      description: t('moderation.filterConfirm', { action, kind: filterKind, value }),
      run: async () => {
        await api('/api/v1/moderation/filters', {
          method: 'POST',
          body: JSON.stringify({ kind: filterKind, action, value, confirm: true, reload: true }),
        })
        await loadFilters()
      },
    })
  }

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }} wrap>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {t('pages.moderation.title')}
        </Typography.Title>
        {tab === 'bans' && (
          <Space wrap>
            <Button onClick={() => void load()}>{t('common.refresh')}</Button>
            {hasMinRole('gm') && (
              <>
                <Button type="primary" danger onClick={() => setBanOpen(true)}>
                  {t('moderation.ban')}
                </Button>
                <Button onClick={() => setMuteOpen(true)}>{t('moderation.mute')}</Button>
                <Button onClick={() => setFreezeOpen(true)}>{t('moderation.freeze')}</Button>
              </>
            )}
          </Space>
        )}
      </Space>

      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: 'bans',
            label: t('moderation.bans'),
            children: (
              <Tabs
                items={[
                  {
                    key: 'account',
                    label: t('moderation.accountBans'),
                    children: (
                      <Table
                        loading={loading}
                        rowKey={(r) => String(r.id ?? r.account_id)}
                        dataSource={data?.account ?? []}
                        columns={[
                          { title: t('accounts.username'), dataIndex: 'username' },
                          { title: t('moderation.reason'), dataIndex: 'reason' },
                          { title: t('moderation.by'), dataIndex: 'bannedby' },
                          { title: t('moderation.from'), dataIndex: 'bandate', render: fmtTime },
                          { title: t('moderation.until'), dataIndex: 'unbandate', render: fmtTime },
                          {
                            title: t('common.actions'),
                            render: (_, row) =>
                              hasMinRole('gm') ? (
                                <Button
                                  size="small"
                                  onClick={() =>
                                    setPending({
                                      title: t('moderation.unban'),
                                      description: t('moderation.unbanConfirm', {
                                        target: String(row.username),
                                      }),
                                      run: async () => {
                                        await api('/api/v1/moderation/unban', {
                                          method: 'POST',
                                          body: JSON.stringify({
                                            type: 'account',
                                            target: row.username,
                                            confirm: true,
                                          }),
                                        })
                                      },
                                    })
                                  }
                                >
                                  {t('moderation.unban')}
                                </Button>
                              ) : null,
                          },
                        ]}
                      />
                    ),
                  },
                  {
                    key: 'ip',
                    label: t('moderation.ipBans'),
                    children: (
                      <Table
                        loading={loading}
                        rowKey={(r) => String(r.ip)}
                        dataSource={data?.ip ?? []}
                        columns={[
                          { title: 'IP', dataIndex: 'ip' },
                          { title: t('moderation.reason'), dataIndex: 'reason' },
                          { title: t('moderation.by'), dataIndex: 'bannedby' },
                          { title: t('moderation.from'), dataIndex: 'bandate', render: fmtTime },
                          { title: t('moderation.until'), dataIndex: 'unbandate', render: fmtTime },
                          {
                            title: t('common.actions'),
                            render: (_, row) =>
                              hasMinRole('gm') ? (
                                <Button
                                  size="small"
                                  onClick={() =>
                                    setPending({
                                      title: t('moderation.unban'),
                                      description: t('moderation.unbanConfirm', {
                                        target: String(row.ip),
                                      }),
                                      run: async () => {
                                        await api('/api/v1/moderation/unban', {
                                          method: 'POST',
                                          body: JSON.stringify({
                                            type: 'ip',
                                            target: row.ip,
                                            confirm: true,
                                          }),
                                        })
                                      },
                                    })
                                  }
                                >
                                  {t('moderation.unban')}
                                </Button>
                              ) : null,
                          },
                        ]}
                      />
                    ),
                  },
                  {
                    key: 'character',
                    label: t('moderation.charBans'),
                    children: (
                      <Table
                        loading={loading}
                        rowKey={(r) => String(r.guid)}
                        dataSource={data?.character ?? []}
                        columns={[
                          { title: t('characters.name'), dataIndex: 'name' },
                          { title: t('moderation.reason'), dataIndex: 'reason' },
                          { title: t('moderation.by'), dataIndex: 'bannedby' },
                          { title: t('moderation.from'), dataIndex: 'bandate', render: fmtTime },
                          { title: t('moderation.until'), dataIndex: 'unbandate', render: fmtTime },
                          {
                            title: t('common.actions'),
                            render: (_, row) =>
                              hasMinRole('gm') ? (
                                <Button
                                  size="small"
                                  onClick={() =>
                                    setPending({
                                      title: t('moderation.unban'),
                                      description: t('moderation.unbanConfirm', {
                                        target: String(row.name),
                                      }),
                                      run: async () => {
                                        await api('/api/v1/moderation/unban', {
                                          method: 'POST',
                                          body: JSON.stringify({
                                            type: 'character',
                                            target: row.name,
                                            confirm: true,
                                          }),
                                        })
                                      },
                                    })
                                  }
                                >
                                  {t('moderation.unban')}
                                </Button>
                              ) : null,
                          },
                        ]}
                      />
                    ),
                  },
                ]}
              />
            ),
          },
          {
            key: 'loginLogs',
            label: t('moderation.loginLogs'),
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                <Space wrap>
                  <Input
                    allowClear
                    placeholder={t('accounts.username')}
                    value={logAccount}
                    onChange={(e) => setLogAccount(e.target.value)}
                    style={{ width: 180 }}
                  />
                  <Input
                    allowClear
                    placeholder={t('moderation.ip')}
                    value={logIp}
                    onChange={(e) => setLogIp(e.target.value)}
                    style={{ width: 160 }}
                  />
                  <Button type="primary" onClick={() => void loadLogs()}>
                    {t('common.search')}
                  </Button>
                </Space>
                <Typography.Title level={5}>{t('moderation.failedLogins')}</Typography.Title>
                <Table
                  size="small"
                  loading={logsLoading}
                  rowKey={(r) => String(r.id)}
                  dataSource={logs?.failed_logins ?? []}
                  columns={[
                    { title: 'ID', dataIndex: 'id', width: 80 },
                    { title: t('accounts.username'), dataIndex: 'username' },
                    { title: t('accounts.lastIp'), dataIndex: 'last_ip' },
                    { title: t('moderation.attemptIp'), dataIndex: 'last_attempt_ip' },
                    { title: t('moderation.failedCount'), dataIndex: 'failed_logins', width: 100 },
                    {
                      title: t('accounts.lastLogin'),
                      dataIndex: 'last_login',
                      render: fmtTime,
                    },
                  ]}
                />
                <Typography.Title level={5}>{t('moderation.ipActions')}</Typography.Title>
                <Table
                  size="small"
                  loading={logsLoading}
                  rowKey={(r) => String(r.id)}
                  dataSource={logs?.ip_actions ?? []}
                  columns={[
                    { title: 'ID', dataIndex: 'id', width: 80 },
                    { title: t('accounts.username'), dataIndex: 'account_id' },
                    { title: t('common.type'), dataIndex: 'type', width: 80 },
                    { title: 'IP', dataIndex: 'ip' },
                    { title: t('moderation.note'), dataIndex: 'systemnote', ellipsis: true },
                    { title: t('audit.at'), dataIndex: 'unixtime', render: fmtTime },
                    { title: t('moderation.reason'), dataIndex: 'comment', ellipsis: true },
                  ]}
                />
              </Space>
            ),
          },
          {
            key: 'filters',
            label: t('moderation.filters'),
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                <Space wrap>
                  <Select
                    style={{ width: 200 }}
                    value={filterKind}
                    onChange={(v) => setFilterKind(v)}
                    options={[
                      { value: 'chat_filter', label: t('moderation.kindChat') },
                      { value: 'reserved_name', label: t('moderation.kindReserved') },
                      { value: 'profanity_name', label: t('moderation.kindProfanity') },
                    ]}
                  />
                  <Button onClick={() => void loadFilters()}>{t('common.refresh')}</Button>
                </Space>
                {hasMinRole('gm') && (
                  <Space wrap>
                    <Input
                      value={filterValue}
                      onChange={(e) => setFilterValue(e.target.value)}
                      placeholder={t('moderation.filterValue')}
                      style={{ width: 220 }}
                    />
                    <Button
                      type="primary"
                      disabled={!filterValue.trim()}
                      onClick={() => {
                        mutateFilter('add', filterValue.trim())
                        setFilterValue('')
                      }}
                    >
                      {t('moderation.filterAdd')}
                    </Button>
                  </Space>
                )}
                <Table
                  size="small"
                  loading={filtersLoading}
                  rowKey={(r, i) => String(r.id ?? r.name ?? i)}
                  dataSource={filters}
                  columns={[
                    ...(filterKind === 'chat_filter'
                      ? [
                          { title: 'ID', dataIndex: 'id', width: 80 },
                          { title: t('moderation.filterValue'), dataIndex: 'word' },
                        ]
                      : [{ title: t('moderation.filterValue'), dataIndex: 'name' }]),
                    {
                      title: t('common.actions'),
                      render: (_: unknown, row: Record<string, unknown>) =>
                        hasMinRole('gm') ? (
                          <Button
                            size="small"
                            danger
                            onClick={() =>
                              mutateFilter(
                                'remove',
                                String(filterKind === 'chat_filter' ? (row.word ?? row.id) : row.name),
                              )
                            }
                          >
                            {t('common.remove')}
                          </Button>
                        ) : null,
                    },
                  ]}
                />
              </Space>
            ),
          },
        ]}
      />

      <BanModal
        open={banOpen}
        onClose={() => setBanOpen(false)}
        onSubmit={(values) => {
          setBanOpen(false)
          setPending({
            title: t('moderation.ban'),
            description: t('moderation.banConfirm', values),
            run: async () => {
              await api('/api/v1/moderation/ban', {
                method: 'POST',
                body: JSON.stringify({ ...values, confirm: true }),
              })
            },
          })
        }}
      />
      <MuteModal
        open={muteOpen}
        onClose={() => setMuteOpen(false)}
        onSubmit={(values) => {
          setMuteOpen(false)
          setPending({
            title: t('moderation.mute'),
            description: t('moderation.muteConfirm', values),
            run: async () => {
              await api('/api/v1/moderation/mute', {
                method: 'POST',
                body: JSON.stringify({ ...values, confirm: true }),
              })
            },
          })
        }}
      />
      <FreezeModal
        open={freezeOpen}
        onClose={() => setFreezeOpen(false)}
        onSubmit={(values) => {
          setFreezeOpen(false)
          setPending({
            title: t('moderation.freeze'),
            description: `${values.action} ${values.name}`,
            run: async () => {
              await api('/api/v1/moderation/freeze', {
                method: 'POST',
                body: JSON.stringify({ ...values, confirm: true }),
              })
            },
          })
        }}
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
            if (tab === 'bans') void load()
          } catch (err) {
            message.error(errorMessage(err, t))
          }
        }}
      />
    </div>
  )
}

function BanModal({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  onSubmit: (v: { type: string; target: string; duration: string; reason: string }) => void
}) {
  const { t } = useTranslation()
  const [form] = Form.useForm()
  return (
    <Modal open={open} title={t('moderation.ban')} onCancel={onClose} onOk={() => form.submit()} destroyOnHidden>
      <Form
        form={form}
        layout="vertical"
        initialValues={{ type: 'account', duration: '-1', reason: 'panel' }}
        onFinish={onSubmit}
      >
        <Form.Item name="type" label={t('moderation.type')} rules={[{ required: true }]}>
          <Select
            options={[
              { value: 'account', label: t('moderation.typeAccount') },
              { value: 'character', label: t('moderation.typeCharacter') },
              { value: 'ip', label: t('moderation.typeIp') },
              { value: 'playeraccount', label: t('moderation.typePlayerAccount') },
            ]}
          />
        </Form.Item>
        <Form.Item name="target" label={t('moderation.target')} rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="duration" label={t('moderation.duration')} rules={[{ required: true }]}>
          <Input placeholder="-1 / 1d / 2h" />
        </Form.Item>
        <Form.Item name="reason" label={t('moderation.reason')} rules={[{ required: true }]}>
          <Input />
        </Form.Item>
      </Form>
    </Modal>
  )
}

function MuteModal({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  onSubmit: (v: { name: string; duration: string; reason: string }) => void
}) {
  const { t } = useTranslation()
  const [form] = Form.useForm()
  return (
    <Modal open={open} title={t('moderation.mute')} onCancel={onClose} onOk={() => form.submit()} destroyOnHidden>
      <Form
        form={form}
        layout="vertical"
        initialValues={{ duration: '1h', reason: 'panel' }}
        onFinish={onSubmit}
      >
        <Form.Item name="name" label={t('characters.name')} rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="duration" label={t('moderation.duration')} rules={[{ required: true }]}>
          <Input placeholder="1h / 30m" />
        </Form.Item>
        <Form.Item name="reason" label={t('moderation.reason')} rules={[{ required: true }]}>
          <Input />
        </Form.Item>
      </Form>
    </Modal>
  )
}

function FreezeModal({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  onSubmit: (v: { name: string; action: string }) => void
}) {
  const { t } = useTranslation()
  const [form] = Form.useForm()
  return (
    <Modal open={open} title={t('moderation.freeze')} onCancel={onClose} onOk={() => form.submit()} destroyOnHidden>
      <Form form={form} layout="vertical" initialValues={{ action: 'freeze' }} onFinish={onSubmit}>
        <Form.Item name="action" label={t('moderation.type')} rules={[{ required: true }]}>
          <Select
            options={[
              { value: 'freeze', label: t('moderation.freeze') },
              { value: 'unfreeze', label: t('moderation.unfreeze') },
            ]}
          />
        </Form.Item>
        <Form.Item name="name" label={t('characters.name')} rules={[{ required: true }]}>
          <Input />
        </Form.Item>
      </Form>
    </Modal>
  )
}
