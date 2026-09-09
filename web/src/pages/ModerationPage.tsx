import type { ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, errorMessage, hasMinRole } from '../api/client'
import { ConfirmDanger } from '../components/ConfirmDanger'
import { DataTable, Modal, Select, Tabs, toast, type Column } from '../ui'

type Row = Record<string, unknown>

type BanLists = {
  account?: Row[]
  ip?: Row[]
  character?: Row[]
}

type LoginLogs = {
  failed_logins: Row[]
  ip_actions: Row[]
}

type FilterKind = 'chat_filter' | 'reserved_name' | 'profanity_name'

function Field({
  label,
  error,
  children,
}: {
  label: ReactNode
  error?: string
  children: ReactNode
}) {
  return (
    <label className="form-control w-full">
      <span className="label-text mb-1">{label}</span>
      {children}
      {error && <span className="label-text-alt text-error mt-1">{error}</span>}
    </label>
  )
}

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
  const [filters, setFilters] = useState<Row[]>([])
  const [filtersLoading, setFiltersLoading] = useState(false)
  const [filterValue, setFilterValue] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await api<BanLists>('/api/v1/moderation/bans'))
    } catch (err) {
      toast.error(errorMessage(err, t))
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
      toast.error(errorMessage(err, t))
    } finally {
      setLogsLoading(false)
    }
  }, [logAccount, logIp, t])

  const loadFilters = useCallback(async () => {
    setFiltersLoading(true)
    try {
      const data = await api<{ items: Row[] }>(`/api/v1/moderation/filters?kind=${filterKind}`)
      setFilters(data.items ?? [])
    } catch (err) {
      toast.error(errorMessage(err, t))
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

  const unbanAction = (type: 'account' | 'ip' | 'character', target: unknown) => {
    setPending({
      title: t('moderation.unban'),
      description: t('moderation.unbanConfirm', { target: String(target) }),
      run: async () => {
        await api('/api/v1/moderation/unban', {
          method: 'POST',
          body: JSON.stringify({ type, target, confirm: true }),
        })
      },
    })
  }

  const banColumns = (
    firstColumn: Column<Row>,
    type: 'account' | 'ip' | 'character',
    targetKey: string,
  ): Column<Row>[] => [
    firstColumn,
    { key: 'reason', title: t('moderation.reason'), dataIndex: 'reason' },
    { key: 'bannedby', title: t('moderation.by'), dataIndex: 'bannedby' },
    { key: 'bandate', title: t('moderation.from'), dataIndex: 'bandate', render: fmtTime },
    { key: 'unbandate', title: t('moderation.until'), dataIndex: 'unbandate', render: fmtTime },
    {
      key: 'actions',
      title: t('common.actions'),
      render: (_v, row) =>
        hasMinRole('gm') ? (
          <button type="button" className="btn btn-xs" onClick={() => unbanAction(type, row[targetKey])}>
            {t('moderation.unban')}
          </button>
        ) : null,
    },
  ]

  const filterColumns: Column<Row>[] = [
    ...(filterKind === 'chat_filter'
      ? [
          { key: 'id', title: 'ID', dataIndex: 'id', width: 80 },
          { key: 'word', title: t('moderation.filterValue'), dataIndex: 'word' },
        ]
      : [{ key: 'name', title: t('moderation.filterValue'), dataIndex: 'name' }]),
    {
      key: 'actions',
      title: t('common.actions'),
      render: (_v, row) =>
        hasMinRole('gm') ? (
          <button
            type="button"
            className="btn btn-xs btn-error"
            onClick={() =>
              mutateFilter(
                'remove',
                String(filterKind === 'chat_filter' ? (row.word ?? row.id) : row.name),
              )
            }
          >
            {t('common.remove')}
          </button>
        ) : null,
    },
  ]

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-xl font-semibold m-0">{t('pages.moderation.title')}</h2>
        {tab === 'bans' && (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn btn-sm" onClick={() => void load()}>
              {t('common.refresh')}
            </button>
            {hasMinRole('gm') && (
              <>
                <button type="button" className="btn btn-sm btn-error" onClick={() => setBanOpen(true)}>
                  {t('moderation.ban')}
                </button>
                <button type="button" className="btn btn-sm" onClick={() => setMuteOpen(true)}>
                  {t('moderation.mute')}
                </button>
                <button type="button" className="btn btn-sm" onClick={() => setFreezeOpen(true)}>
                  {t('moderation.freeze')}
                </button>
              </>
            )}
          </div>
        )}
      </div>

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
                      <DataTable
                        loading={loading}
                        rowKey={(r) => String(r.id ?? r.account_id)}
                        dataSource={data?.account ?? []}
                        columns={banColumns(
                          { key: 'username', title: t('accounts.username'), dataIndex: 'username' },
                          'account',
                          'username',
                        )}
                      />
                    ),
                  },
                  {
                    key: 'ip',
                    label: t('moderation.ipBans'),
                    children: (
                      <DataTable
                        loading={loading}
                        rowKey={(r) => String(r.ip)}
                        dataSource={data?.ip ?? []}
                        columns={banColumns({ key: 'ip', title: 'IP', dataIndex: 'ip' }, 'ip', 'ip')}
                      />
                    ),
                  },
                  {
                    key: 'character',
                    label: t('moderation.charBans'),
                    children: (
                      <DataTable
                        loading={loading}
                        rowKey={(r) => String(r.guid)}
                        dataSource={data?.character ?? []}
                        columns={banColumns(
                          { key: 'name', title: t('characters.name'), dataIndex: 'name' },
                          'character',
                          'name',
                        )}
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
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className="input input-bordered input-sm w-[180px]"
                    placeholder={t('accounts.username')}
                    value={logAccount}
                    onChange={(e) => setLogAccount(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void loadLogs()
                    }}
                  />
                  <input
                    className="input input-bordered input-sm w-[160px]"
                    placeholder={t('moderation.ip')}
                    value={logIp}
                    onChange={(e) => setLogIp(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void loadLogs()
                    }}
                  />
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => void loadLogs()}>
                    {t('common.search')}
                  </button>
                </div>

                <h3 className="font-semibold m-0">{t('moderation.failedLogins')}</h3>
                <DataTable
                  loading={logsLoading}
                  rowKey={(r) => String(r.id)}
                  dataSource={logs?.failed_logins ?? []}
                  columns={[
                    { key: 'id', title: 'ID', dataIndex: 'id', width: 80 },
                    { key: 'username', title: t('accounts.username'), dataIndex: 'username' },
                    { key: 'last_ip', title: t('accounts.lastIp'), dataIndex: 'last_ip' },
                    { key: 'last_attempt_ip', title: t('moderation.attemptIp'), dataIndex: 'last_attempt_ip' },
                    {
                      key: 'failed_logins',
                      title: t('moderation.failedCount'),
                      dataIndex: 'failed_logins',
                      width: 100,
                    },
                    {
                      key: 'last_login',
                      title: t('accounts.lastLogin'),
                      dataIndex: 'last_login',
                      render: fmtTime,
                    },
                  ]}
                />

                <h3 className="font-semibold m-0">{t('moderation.ipActions')}</h3>
                <DataTable
                  loading={logsLoading}
                  rowKey={(r) => String(r.id)}
                  dataSource={logs?.ip_actions ?? []}
                  columns={[
                    { key: 'id', title: 'ID', dataIndex: 'id', width: 80 },
                    { key: 'account_id', title: t('accounts.username'), dataIndex: 'account_id' },
                    { key: 'type', title: t('common.type'), dataIndex: 'type', width: 80 },
                    { key: 'ip', title: 'IP', dataIndex: 'ip' },
                    {
                      key: 'systemnote',
                      title: t('moderation.note'),
                      dataIndex: 'systemnote',
                      className: 'max-w-[240px] truncate',
                    },
                    { key: 'unixtime', title: t('audit.at'), dataIndex: 'unixtime', render: fmtTime },
                    {
                      key: 'comment',
                      title: t('moderation.reason'),
                      dataIndex: 'comment',
                      className: 'max-w-[240px] truncate',
                    },
                  ]}
                />
              </div>
            ),
          },
          {
            key: 'filters',
            label: t('moderation.filters'),
            children: (
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="w-[200px]">
                    <Select<FilterKind>
                      className="select-sm"
                      value={filterKind}
                      onChange={(v) => setFilterKind(v ?? 'chat_filter')}
                      options={[
                        { value: 'chat_filter', label: t('moderation.kindChat') },
                        { value: 'reserved_name', label: t('moderation.kindReserved') },
                        { value: 'profanity_name', label: t('moderation.kindProfanity') },
                      ]}
                    />
                  </div>
                  <button type="button" className="btn btn-sm" onClick={() => void loadFilters()}>
                    {t('common.refresh')}
                  </button>
                </div>

                {hasMinRole('gm') && (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      className="input input-bordered input-sm w-[220px]"
                      value={filterValue}
                      onChange={(e) => setFilterValue(e.target.value)}
                      placeholder={t('moderation.filterValue')}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter' || !filterValue.trim()) return
                        mutateFilter('add', filterValue.trim())
                        setFilterValue('')
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      disabled={!filterValue.trim()}
                      onClick={() => {
                        mutateFilter('add', filterValue.trim())
                        setFilterValue('')
                      }}
                    >
                      {t('moderation.filterAdd')}
                    </button>
                  </div>
                )}

                <DataTable
                  loading={filtersLoading}
                  rowKey={(r) => String(r.id ?? r.name ?? '')}
                  dataSource={filters}
                  columns={filterColumns}
                />
              </div>
            ),
          },
        ]}
      />

      {banOpen && (
        <BanModal
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
      )}

      {muteOpen && (
        <MuteModal
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
      )}

      {freezeOpen && (
        <FreezeModal
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
      )}

      <ConfirmDanger
        open={!!pending}
        title={pending?.title}
        description={pending?.description}
        onCancel={() => setPending(null)}
        onConfirm={async () => {
          if (!pending) return
          try {
            await pending.run()
            toast.success(t('common.ok'))
            setPending(null)
            if (tab === 'bans') void load()
          } catch (err) {
            toast.error(errorMessage(err, t))
          }
        }}
      />
    </div>
  )
}

function BanModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void
  onSubmit: (v: { type: string; target: string; duration: string; reason: string }) => void
}) {
  const { t } = useTranslation()
  const [type, setType] = useState('account')
  const [target, setTarget] = useState('')
  const [duration, setDuration] = useState('-1')
  const [reason, setReason] = useState('panel')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const submit = () => {
    const next: Record<string, string> = {}
    if (!target.trim()) next.target = t('validation.required')
    if (!duration.trim()) next.duration = t('validation.required')
    if (!reason.trim()) next.reason = t('validation.required')
    setErrors(next)
    if (Object.keys(next).length > 0) return
    onSubmit({ type, target: target.trim(), duration: duration.trim(), reason: reason.trim() })
  }

  return (
    <Modal open title={t('moderation.ban')} onClose={onClose} onOk={submit}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <Field label={t('moderation.type')}>
          <Select
            value={type}
            onChange={(v) => setType(v ?? 'account')}
            options={[
              { value: 'account', label: t('moderation.typeAccount') },
              { value: 'character', label: t('moderation.typeCharacter') },
              { value: 'ip', label: t('moderation.typeIp') },
              { value: 'playeraccount', label: t('moderation.typePlayerAccount') },
            ]}
          />
        </Field>
        <Field label={t('moderation.target')} error={errors.target}>
          <input
            className="input input-bordered w-full"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
        </Field>
        <Field label={t('moderation.duration')} error={errors.duration}>
          <input
            className="input input-bordered w-full"
            placeholder="-1 / 1d / 2h"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </Field>
        <Field label={t('moderation.reason')} error={errors.reason}>
          <input
            className="input input-bordered w-full"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  )
}

function MuteModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void
  onSubmit: (v: { name: string; duration: string; reason: string }) => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [duration, setDuration] = useState('1h')
  const [reason, setReason] = useState('panel')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const submit = () => {
    const next: Record<string, string> = {}
    if (!name.trim()) next.name = t('validation.required')
    if (!duration.trim()) next.duration = t('validation.required')
    if (!reason.trim()) next.reason = t('validation.required')
    setErrors(next)
    if (Object.keys(next).length > 0) return
    onSubmit({ name: name.trim(), duration: duration.trim(), reason: reason.trim() })
  }

  return (
    <Modal open title={t('moderation.mute')} onClose={onClose} onOk={submit}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <Field label={t('characters.name')} error={errors.name}>
          <input
            className="input input-bordered w-full"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label={t('moderation.duration')} error={errors.duration}>
          <input
            className="input input-bordered w-full"
            placeholder="1h / 30m"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </Field>
        <Field label={t('moderation.reason')} error={errors.reason}>
          <input
            className="input input-bordered w-full"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  )
}

function FreezeModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void
  onSubmit: (v: { name: string; action: string }) => void
}) {
  const { t } = useTranslation()
  const [action, setAction] = useState('freeze')
  const [name, setName] = useState('')
  const [error, setError] = useState<string>()

  const submit = () => {
    if (!name.trim()) {
      setError(t('validation.required'))
      return
    }
    setError(undefined)
    onSubmit({ name: name.trim(), action })
  }

  return (
    <Modal open title={t('moderation.freeze')} onClose={onClose} onOk={submit}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <Field label={t('moderation.type')}>
          <Select
            value={action}
            onChange={(v) => setAction(v ?? 'freeze')}
            options={[
              { value: 'freeze', label: t('moderation.freeze') },
              { value: 'unfreeze', label: t('moderation.unfreeze') },
            ]}
          />
        </Field>
        <Field label={t('characters.name')} error={error}>
          <input
            className="input input-bordered w-full"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  )
}
