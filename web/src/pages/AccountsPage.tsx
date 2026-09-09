import {
  Button,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, errorMessage, hasMinRole } from '../api/client'
import { ConfirmDanger } from '../components/ConfirmDanger'
import { RowActions, type RowActionItem } from '../components/RowActions'

type Account = {
  id: number
  username: string
  email: string
  last_ip: string
  last_login?: string
  online: number
  locked: number
  expansion: number
  gmlevel: number
  joindate?: string
}

type ListResp = {
  items: Account[]
  total: number
  limit: number
  offset: number
}

type Pending = { title: string; description: string; run: () => Promise<void> }

export function AccountsPage() {
  const { t } = useTranslation()
  const [q, setQ] = useState('')
  const [data, setData] = useState<ListResp | null>(null)
  const [loading, setLoading] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [pwdTarget, setPwdTarget] = useState<Account | null>(null)
  const [gmTarget, setGmTarget] = useState<Account | null>(null)
  const [gmConfirm, setGmConfirm] = useState(false)
  const [gmPending, setGmPending] = useState<{ level: number; realm: number } | null>(null)
  const [detail, setDetail] = useState<Account | null>(null)
  const [twoFA, setTwoFA] = useState<{ enabled: boolean } | null>(null)
  const [twoFALoading, setTwoFALoading] = useState(false)
  const [addonTarget, setAddonTarget] = useState<Account | null>(null)
  const [flagsTarget, setFlagsTarget] = useState<Account | null>(null)
  const [phraseTarget, setPhraseTarget] = useState<{
    account: Account
    kind: '2fa' | 'delete'
  } | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)

  const load = useCallback(
    async (offset = 0) => {
      setLoading(true)
      try {
        const params = new URLSearchParams({ limit: '50', offset: String(offset) })
        if (q.trim()) params.set('q', q.trim())
        const resp = await api<ListResp>(`/api/v1/accounts?${params}`)
        setData(resp)
      } catch (err) {
        message.error(errorMessage(err, t))
      } finally {
        setLoading(false)
      }
    },
    [q, t],
  )

  useEffect(() => {
    void load(0)
  }, [load])

  const openDetail = async (row: Account) => {
    setDetail(row)
    setTwoFA(null)
    if (!hasMinRole('gm')) return
    setTwoFALoading(true)
    try {
      const resp = await api<{ enabled: boolean }>(
        `/api/v1/accounts/${encodeURIComponent(row.username)}/2fa`,
      )
      setTwoFA({ enabled: resp.enabled })
    } catch (err) {
      message.error(errorMessage(err, t))
    } finally {
      setTwoFALoading(false)
    }
  }

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }} wrap>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {t('pages.accounts.title')}
        </Typography.Title>
        <Space wrap>
          <Input.Search
            allowClear
            placeholder={t('accounts.search')}
            onSearch={() => void load(0)}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ width: 220 }}
          />
          <Button onClick={() => void load(data?.offset ?? 0)}>{t('common.refresh')}</Button>
          {hasMinRole('gm') && (
            <Button type="primary" onClick={() => setCreateOpen(true)}>
              {t('accounts.create')}
            </Button>
          )}
        </Space>
      </Space>

      <Table
        loading={loading}
        rowKey="id"
        dataSource={data?.items ?? []}
        pagination={{
          current: Math.floor((data?.offset ?? 0) / (data?.limit ?? 50)) + 1,
          pageSize: data?.limit ?? 50,
          total: data?.total ?? 0,
          onChange: (page, pageSize) => void load((page - 1) * pageSize),
        }}
        columns={[
          { title: 'ID', dataIndex: 'id', width: 80 },
          { title: t('accounts.username'), dataIndex: 'username' },
          {
            title: t('accounts.gmlevel'),
            dataIndex: 'gmlevel',
            width: 90,
            render: (v: number) => (v > 0 ? <Tag color="gold">{v}</Tag> : v),
          },
          {
            title: t('accounts.locked'),
            dataIndex: 'locked',
            width: 80,
            render: (v: number) => (v ? <Tag color="error">{t('common.yes')}</Tag> : t('common.no')),
          },
          {
            title: t('accounts.online'),
            dataIndex: 'online',
            width: 90,
            render: (v: number) => (v ? <Tag color="success">{t('common.yes')}</Tag> : t('common.no')),
          },
          { title: t('accounts.lastIp'), dataIndex: 'last_ip' },
          {
            title: t('accounts.lastLogin'),
            dataIndex: 'last_login',
            render: (v?: string) => (v ? new Date(v).toLocaleString() : '-'),
          },
          {
            title: t('common.actions'),
            width: 160,
            render: (_, row) => {
              const items: RowActionItem[] = []
              if (hasMinRole('gm')) {
                items.push(
                  {
                    key: 'password',
                    label: t('accounts.setPassword'),
                    hint: t('accounts.setPasswordHint'),
                    group: t('accounts.groupManage'),
                    onClick: () => setPwdTarget(row),
                  },
                  {
                    key: 'lock',
                    label: row.locked ? t('accounts.unlock') : t('accounts.lock'),
                    hint: row.locked ? t('accounts.unlockHint') : t('accounts.lockHint'),
                    group: t('accounts.groupManage'),
                    onClick: () =>
                      setPending({
                        title: t('accounts.lock'),
                        description: t('accounts.lockConfirm', {
                          user: row.username,
                          locked: row.locked ? 0 : 1,
                        }),
                        run: async () => {
                          await api(`/api/v1/accounts/${encodeURIComponent(row.username)}/lock`, {
                            method: 'POST',
                            body: JSON.stringify({ locked: row.locked ? 0 : 1, confirm: true }),
                          })
                        },
                      }),
                  },
                  {
                    key: 'addon',
                    label: t('accounts.addon'),
                    hint: t('accounts.addonHint'),
                    group: t('accounts.groupManage'),
                    onClick: () => setAddonTarget(row),
                  },
                  {
                    key: 'flags',
                    label: t('accounts.flags'),
                    hint: t('accounts.flagsHint'),
                    group: t('accounts.groupManage'),
                    onClick: () => setFlagsTarget(row),
                  },
                )
              }
              if (hasMinRole('superadmin')) {
                items.push(
                  {
                    key: 'gm',
                    label: t('accounts.setGm'),
                    hint: t('accounts.setGmHint'),
                    onClick: () => setGmTarget(row),
                  },
                  {
                    key: 'delete',
                    label: t('common.delete'),
                    hint: t('accounts.deleteHint'),
                    danger: true,
                    onClick: () => setPhraseTarget({ account: row, kind: 'delete' }),
                  },
                )
              }
              return (
                <RowActions
                  primary={
                    <Button size="small" onClick={() => void openDetail(row)}>
                      {t('accounts.view2fa')}
                    </Button>
                  }
                  primaryHint={t('accounts.view2faHint')}
                  moreHint={t('common.moreHint')}
                  items={items}
                />
              )
            },
          },
        ]}
      />

      <Drawer
        open={!!detail}
        width={420}
        title={detail?.username}
        onClose={() => {
          setDetail(null)
          setTwoFA(null)
        }}
      >
        {detail && (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Typography.Text>
              {t('accounts.2faStatus')}:{' '}
              {twoFALoading
                ? t('common.loading')
                : twoFA
                  ? twoFA.enabled
                    ? t('accounts.2faEnabled')
                    : t('accounts.2faDisabled')
                  : '-'}
            </Typography.Text>
            {hasMinRole('superadmin') && twoFA?.enabled && (
              <Tooltip title={t('accounts.disable2faHint')}>
                <Button danger onClick={() => setPhraseTarget({ account: detail, kind: '2fa' })}>
                  {t('accounts.disable2fa')}
                </Button>
              </Tooltip>
            )}
          </Space>
        )}
      </Drawer>

      <CreateAccountModal open={createOpen} onClose={() => setCreateOpen(false)} onDone={() => void load(0)} />
      <PasswordModal
        account={pwdTarget}
        onClose={() => setPwdTarget(null)}
        onDone={() => {
          setPwdTarget(null)
          void load(data?.offset ?? 0)
        }}
      />
      <GmLevelModal
        account={gmTarget}
        onClose={() => setGmTarget(null)}
        onSubmit={(values) => {
          setGmPending(values)
          setGmConfirm(true)
        }}
      />
      <AddonModal
        account={addonTarget}
        onClose={() => setAddonTarget(null)}
        onSubmit={(addon) => {
          if (!addonTarget) return
          const user = addonTarget.username
          setAddonTarget(null)
          setPending({
            title: t('accounts.addon'),
            description: t('accounts.addonConfirm', { user, addon }),
            run: async () => {
              await api(`/api/v1/accounts/${encodeURIComponent(user)}/addon`, {
                method: 'POST',
                body: JSON.stringify({ addon, confirm: true }),
              })
            },
          })
        }}
      />
      <FlagsModal
        account={flagsTarget}
        onClose={() => setFlagsTarget(null)}
        onAction={(action, flag) => {
          if (!flagsTarget) return
          const user = flagsTarget.username
          if (action === 'list') {
            void api<{ result?: string }>(`/api/v1/accounts/${encodeURIComponent(user)}/flags`, {
              method: 'POST',
              body: JSON.stringify({ action: 'list' }),
            })
              .then((resp) => {
                message.info(typeof resp === 'object' ? JSON.stringify(resp) : String(resp))
              })
              .catch((err) => message.error(errorMessage(err, t)))
            return
          }
          setFlagsTarget(null)
          setPending({
            title: t('accounts.flags'),
            description: t('accounts.flagsConfirm', { user, action, flag }),
            run: async () => {
              await api(`/api/v1/accounts/${encodeURIComponent(user)}/flags`, {
                method: 'POST',
                body: JSON.stringify({ action, flag, confirm: true }),
              })
            },
          })
        }}
      />
      <PhraseConfirmModal
        target={phraseTarget}
        onClose={() => setPhraseTarget(null)}
        onConfirm={async (phrase) => {
          if (!phraseTarget) return
          const user = phraseTarget.account.username
          try {
            if (phraseTarget.kind === '2fa') {
              await api(`/api/v1/accounts/${encodeURIComponent(user)}/2fa/disable`, {
                method: 'POST',
                body: JSON.stringify({ confirm: true, phrase }),
              })
            } else {
              await api(`/api/v1/accounts/${encodeURIComponent(user)}`, {
                method: 'DELETE',
                body: JSON.stringify({ confirm: true, phrase }),
              })
              setDetail(null)
            }
            message.success(t('common.ok'))
            setPhraseTarget(null)
            void load(data?.offset ?? 0)
            if (phraseTarget.kind === '2fa' && detail) void openDetail(detail)
          } catch (err) {
            message.error(errorMessage(err, t))
          }
        }}
      />
      <ConfirmDanger
        open={gmConfirm}
        description={
          gmTarget && gmPending
            ? t('accounts.gmConfirm', {
                user: gmTarget.username,
                level: gmPending.level,
                realm: gmPending.realm,
              })
            : undefined
        }
        onCancel={() => {
          setGmConfirm(false)
          setGmPending(null)
        }}
        onConfirm={async () => {
          if (!gmTarget || !gmPending) return
          try {
            await api(`/api/v1/accounts/${encodeURIComponent(gmTarget.username)}/gmlevel`, {
              method: 'POST',
              body: JSON.stringify({ ...gmPending, confirm: true }),
            })
            message.success(t('common.ok'))
            setGmConfirm(false)
            setGmPending(null)
            setGmTarget(null)
            void load(data?.offset ?? 0)
          } catch (err) {
            message.error(errorMessage(err, t))
          }
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
            void load(data?.offset ?? 0)
          } catch (err) {
            message.error(errorMessage(err, t))
          }
        }}
      />
    </div>
  )
}

function CreateAccountModal({
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
    <Modal open={open} title={t('accounts.create')} onCancel={onClose} onOk={() => form.submit()} destroyOnHidden>
      <Form
        form={form}
        layout="vertical"
        onFinish={async (values: { username: string; password: string }) => {
          try {
            await api('/api/v1/accounts', { method: 'POST', body: JSON.stringify(values) })
            message.success(t('common.ok'))
            form.resetFields()
            onDone()
            onClose()
          } catch (err) {
            message.error(errorMessage(err, t))
          }
        }}
      >
        <Form.Item name="username" label={t('accounts.username')} rules={[{ required: true }]}>
          <Input maxLength={32} />
        </Form.Item>
        <Form.Item name="password" label={t('accounts.password')} rules={[{ required: true, min: 4 }]}>
          <Input.Password maxLength={32} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

function PasswordModal({
  account,
  onClose,
  onDone,
}: {
  account: Account | null
  onClose: () => void
  onDone: () => void
}) {
  const { t } = useTranslation()
  const [form] = Form.useForm()
  return (
    <Modal
      open={!!account}
      title={t('accounts.setPassword')}
      onCancel={onClose}
      onOk={() => form.submit()}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={async (values: { password: string }) => {
          if (!account) return
          try {
            await api(`/api/v1/accounts/${encodeURIComponent(account.username)}/password`, {
              method: 'POST',
              body: JSON.stringify(values),
            })
            message.success(t('common.ok'))
            form.resetFields()
            onDone()
          } catch (err) {
            message.error(errorMessage(err, t))
          }
        }}
      >
        <Form.Item label={t('accounts.username')}>
          <Input value={account?.username} disabled />
        </Form.Item>
        <Form.Item name="password" label={t('accounts.password')} rules={[{ required: true, min: 4 }]}>
          <Input.Password maxLength={32} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

function GmLevelModal({
  account,
  onClose,
  onSubmit,
}: {
  account: Account | null
  onClose: () => void
  onSubmit: (v: { level: number; realm: number }) => void
}) {
  const { t } = useTranslation()
  const [form] = Form.useForm()
  return (
    <Modal open={!!account} title={t('accounts.setGm')} onCancel={onClose} onOk={() => form.submit()} destroyOnHidden>
      <Form
        form={form}
        layout="vertical"
        initialValues={{ level: account?.gmlevel ?? 0, realm: -1 }}
        onFinish={(values: { level: number; realm: number }) => onSubmit(values)}
      >
        <Form.Item label={t('accounts.username')}>
          <Input value={account?.username} disabled />
        </Form.Item>
        <Form.Item name="level" label={t('accounts.gmlevel')} rules={[{ required: true }]}>
          <InputNumber min={0} max={3} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="realm" label={t('accounts.realm')} rules={[{ required: true }]}>
          <InputNumber style={{ width: '100%' }} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

function AddonModal({
  account,
  onClose,
  onSubmit,
}: {
  account: Account | null
  onClose: () => void
  onSubmit: (addon: number) => void
}) {
  const { t } = useTranslation()
  const [form] = Form.useForm()
  return (
    <Modal open={!!account} title={t('accounts.addon')} onCancel={onClose} onOk={() => form.submit()} destroyOnHidden>
      <Form
        form={form}
        layout="vertical"
        initialValues={{ addon: account?.expansion ?? 2 }}
        onFinish={(values: { addon: number }) => onSubmit(values.addon)}
      >
        <Form.Item name="addon" label={t('accounts.addon')} rules={[{ required: true }]}>
          <InputNumber min={0} max={2} style={{ width: '100%' }} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

function FlagsModal({
  account,
  onClose,
  onAction,
}: {
  account: Account | null
  onClose: () => void
  onAction: (action: string, flag: string) => void
}) {
  const { t } = useTranslation()
  const [form] = Form.useForm()
  return (
    <Modal open={!!account} title={t('accounts.flags')} onCancel={onClose} onOk={() => form.submit()} destroyOnHidden>
      <Form
        form={form}
        layout="vertical"
        initialValues={{ action: 'list' }}
        onFinish={(values: { action: string; flag?: string }) => onAction(values.action, values.flag ?? '')}
      >
        <Form.Item name="action" label={t('moderation.type')} rules={[{ required: true }]}>
          <Select
            options={[
              { value: 'list', label: t('common.list') },
              { value: 'add', label: t('common.add') },
              { value: 'remove', label: t('common.remove') },
            ]}
          />
        </Form.Item>
        <Form.Item noStyle shouldUpdate={(prev, cur) => prev.action !== cur.action}>
          {({ getFieldValue }) =>
            getFieldValue('action') !== 'list' ? (
              <Form.Item name="flag" label={t('accounts.flag')} rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            ) : null
          }
        </Form.Item>
      </Form>
    </Modal>
  )
}

function PhraseConfirmModal({
  target,
  onClose,
  onConfirm,
}: {
  target: { account: Account; kind: '2fa' | 'delete' } | null
  onClose: () => void
  onConfirm: (phrase: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const [form] = Form.useForm()
  const title =
    target?.kind === '2fa'
      ? t('accounts.disable2fa')
      : target?.kind === 'delete'
        ? t('accounts.delete')
        : undefined
  return (
    <Modal
      open={!!target}
      title={title}
      okButtonProps={{ danger: true }}
      onCancel={onClose}
      onOk={() => form.submit()}
      destroyOnHidden
    >
      <Typography.Paragraph>
        {target?.kind === '2fa'
          ? t('accounts.disable2faConfirm', { user: target.account.username })
          : target
            ? t('accounts.deleteConfirm', { user: target.account.username })
            : null}
      </Typography.Paragraph>
      <Form
        form={form}
        layout="vertical"
        onFinish={async (values: { phrase: string }) => {
          await onConfirm(values.phrase)
          form.resetFields()
        }}
      >
        <Form.Item
          name="phrase"
          label={t('accounts.phrase')}
          rules={[
            { required: true },
            {
              validator: async (_, value) => {
                if (value !== target?.account.username) {
                  return Promise.reject(new Error(t('accounts.phraseMismatch')))
                }
              },
            },
          ]}
        >
          <Input placeholder={target?.account.username} autoComplete="off" />
        </Form.Item>
      </Form>
    </Modal>
  )
}
