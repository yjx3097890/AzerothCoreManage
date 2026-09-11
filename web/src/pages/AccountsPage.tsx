import type { ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, errorMessage, hasMinRole } from '../api/client'
import { ConfirmDanger } from '../components/ConfirmDanger'
import { RowActions, type RowActionItem } from '../components/RowActions'
import { DataTable, Drawer, Modal, Select, toast, type Column } from '../ui'

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

function useAccountLabels() {
  const { t } = useTranslation()
  const gmLevelLabel = (level: number) =>
    t(`accounts.gmLevels.${level}`, { defaultValue: String(level) })
  const expansionLabel = (exp: number) =>
    t(`accounts.expansions.${exp}`, { defaultValue: String(exp) })
  return { gmLevelLabel, expansionLabel }
}

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

export function AccountsPage() {
  const { t } = useTranslation()
  const { gmLevelLabel, expansionLabel } = useAccountLabels()
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
        toast.error(errorMessage(err, t))
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
      toast.error(errorMessage(err, t))
    } finally {
      setTwoFALoading(false)
    }
  }

  const limit = data?.limit || 50
  const offset = data?.offset ?? 0
  const total = data?.total ?? 0
  const page = Math.floor(offset / limit) + 1
  const totalPages = Math.max(1, Math.ceil(total / limit))

  const columns: Column<Account>[] = [
    { key: 'id', title: 'ID', dataIndex: 'id', width: 80 },
    { key: 'username', title: t('accounts.username'), dataIndex: 'username' },
    {
      key: 'gmlevel',
      title: t('accounts.gmlevel'),
      dataIndex: 'gmlevel',
      width: 120,
      render: (v) => {
        const level = Number(v ?? 0)
        const label = gmLevelLabel(level)
        return level > 0 ? <span className="badge badge-warning">{label}</span> : label
      },
    },
    {
      key: 'expansion',
      title: t('accounts.addon'),
      dataIndex: 'expansion',
      width: 120,
      render: (v) => expansionLabel(Number(v ?? 0)),
    },
    {
      key: 'locked',
      title: t('accounts.locked'),
      dataIndex: 'locked',
      width: 80,
      render: (v) => (v ? <span className="badge badge-error">{t('common.yes')}</span> : t('common.no')),
    },
    {
      key: 'online',
      title: t('accounts.online'),
      dataIndex: 'online',
      width: 90,
      render: (v) => (v ? <span className="badge badge-success">{t('common.yes')}</span> : t('common.no')),
    },
    { key: 'last_ip', title: t('accounts.lastIp'), dataIndex: 'last_ip' },
    {
      key: 'last_login',
      title: t('accounts.lastLogin'),
      dataIndex: 'last_login',
      render: (v) => (typeof v === 'string' ? new Date(v).toLocaleString() : '-'),
    },
    {
      key: 'actions',
      title: t('common.actions'),
      width: 160,
      render: (_v, row) => {
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
              group: t('accounts.groupAdmin'),
              onClick: () => setGmTarget(row),
            },
            {
              key: 'delete',
              label: t('common.delete'),
              hint: t('accounts.deleteHint'),
              danger: true,
              group: t('accounts.groupAdmin'),
              onClick: () => setPhraseTarget({ account: row, kind: 'delete' }),
            },
          )
        }
        return (
          <RowActions
            primary={
              <button type="button" className="btn btn-xs" onClick={() => void openDetail(row)}>
                {t('accounts.view2fa')}
              </button>
            }
            primaryHint={t('accounts.view2faHint')}
            moreHint={t('common.moreHint')}
            items={items}
          />
        )
      },
    },
  ]

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-xl font-semibold m-0">{t('pages.accounts.title')}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="input input-bordered input-sm w-[220px]"
            placeholder={t('accounts.search')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void load(0)
            }}
          />
          <button type="button" className="btn btn-sm" onClick={() => void load(0)}>
            {t('common.search')}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => void load(offset)}>
            {t('common.refresh')}
          </button>
          {hasMinRole('gm') && (
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setCreateOpen(true)}>
              {t('accounts.create')}
            </button>
          )}
        </div>
      </div>

      <DataTable
        columns={columns}
        dataSource={data?.items ?? []}
        rowKey="id"
        loading={loading}
        pagination={false}
      />

      {total > limit && (
        <div className="flex items-center justify-end gap-2 mt-3">
          <span className="text-sm text-base-content/60">
            {total} · {page}/{totalPages}
          </span>
          <button
            type="button"
            className="btn btn-sm"
            disabled={page <= 1 || loading}
            onClick={() => void load((page - 2) * limit)}
          >
            ‹
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={page >= totalPages || loading}
            onClick={() => void load(page * limit)}
          >
            ›
          </button>
        </div>
      )}

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
          <div className="flex flex-col items-start gap-3">
            <p className="m-0">
              {t('accounts.2faStatus')}:{' '}
              {twoFALoading
                ? t('common.loading')
                : twoFA
                  ? twoFA.enabled
                    ? t('accounts.2faEnabled')
                    : t('accounts.2faDisabled')
                  : '-'}
            </p>
            {hasMinRole('superadmin') && twoFA?.enabled && (
              <span className="tooltip tooltip-right" data-tip={t('accounts.disable2faHint')}>
                <button
                  type="button"
                  className="btn btn-sm btn-error"
                  onClick={() => setPhraseTarget({ account: detail, kind: '2fa' })}
                >
                  {t('accounts.disable2fa')}
                </button>
              </span>
            )}
          </div>
        )}
      </Drawer>

      {createOpen && (
        <CreateAccountModal onClose={() => setCreateOpen(false)} onDone={() => void load(0)} />
      )}

      {pwdTarget && (
        <PasswordModal
          account={pwdTarget}
          onClose={() => setPwdTarget(null)}
          onDone={() => {
            setPwdTarget(null)
            void load(offset)
          }}
        />
      )}

      {gmTarget && (
        <GmLevelModal
          account={gmTarget}
          onClose={() => setGmTarget(null)}
          onSubmit={(values) => {
            setGmPending(values)
            setGmConfirm(true)
          }}
        />
      )}

      {addonTarget && (
        <AddonModal
          account={addonTarget}
          onClose={() => setAddonTarget(null)}
          onSubmit={(addon) => {
            const user = addonTarget.username
            setAddonTarget(null)
            setPending({
              title: t('accounts.addon'),
              description: t('accounts.addonConfirm', {
                user,
                addon: expansionLabel(addon),
              }),
              run: async () => {
                await api(`/api/v1/accounts/${encodeURIComponent(user)}/addon`, {
                  method: 'POST',
                  body: JSON.stringify({ addon, confirm: true }),
                })
              },
            })
          }}
        />
      )}

      {flagsTarget && (
        <FlagsModal
          account={flagsTarget}
          onClose={() => setFlagsTarget(null)}
          onAction={(action, flag) => {
            const user = flagsTarget.username
            if (action === 'list') {
              void api<{ result?: string }>(`/api/v1/accounts/${encodeURIComponent(user)}/flags`, {
                method: 'POST',
                body: JSON.stringify({ action: 'list' }),
              })
                .then((resp) => {
                  toast.info(typeof resp === 'object' ? JSON.stringify(resp) : String(resp))
                })
                .catch((err) => toast.error(errorMessage(err, t)))
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
      )}

      {phraseTarget && (
        <PhraseConfirmModal
          target={phraseTarget}
          onClose={() => setPhraseTarget(null)}
          onConfirm={async (phrase) => {
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
              toast.success(t('common.ok'))
              setPhraseTarget(null)
              void load(offset)
              if (phraseTarget.kind === '2fa' && detail) void openDetail(detail)
            } catch (err) {
              toast.error(errorMessage(err, t))
            }
          }}
        />
      )}

      <ConfirmDanger
        open={gmConfirm}
        description={
          gmTarget && gmPending
            ? t('accounts.gmConfirm', {
                user: gmTarget.username,
                level: gmLevelLabel(gmPending.level),
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
            toast.success(t('common.ok'))
            setGmConfirm(false)
            setGmPending(null)
            setGmTarget(null)
            void load(offset)
          } catch (err) {
            toast.error(errorMessage(err, t))
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
            toast.success(t('common.ok'))
            setPending(null)
            void load(offset)
          } catch (err) {
            toast.error(errorMessage(err, t))
          }
        }}
      />
    </div>
  )
}

function CreateAccountModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<{ username?: string; password?: string }>({})
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    const next: { username?: string; password?: string } = {}
    if (!username.trim()) next.username = t('validation.required')
    if (password.length < 4) next.password = t('validation.required')
    setErrors(next)
    if (next.username || next.password) return

    setSubmitting(true)
    try {
      await api('/api/v1/accounts', {
        method: 'POST',
        body: JSON.stringify({ username: username.trim(), password }),
      })
      toast.success(t('common.ok'))
      onDone()
      onClose()
    } catch (err) {
      toast.error(errorMessage(err, t))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open
      title={t('accounts.create')}
      onClose={onClose}
      onOk={submit}
      confirmLoading={submitting}
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <Field label={t('accounts.username')} error={errors.username}>
          <input
            className="input input-bordered w-full"
            maxLength={32}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="off"
          />
        </Field>
        <Field label={t('accounts.password')} error={errors.password}>
          <input
            type="password"
            className="input input-bordered w-full"
            maxLength={32}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  )
}

function PasswordModal({
  account,
  onClose,
  onDone,
}: {
  account: Account
  onClose: () => void
  onDone: () => void
}) {
  const { t } = useTranslation()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    if (password.length < 4) {
      setError(t('validation.required'))
      return
    }
    setError(undefined)
    setSubmitting(true)
    try {
      await api(`/api/v1/accounts/${encodeURIComponent(account.username)}/password`, {
        method: 'POST',
        body: JSON.stringify({ password }),
      })
      toast.success(t('common.ok'))
      onDone()
    } catch (err) {
      toast.error(errorMessage(err, t))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open
      title={t('accounts.setPassword')}
      onClose={onClose}
      onOk={submit}
      confirmLoading={submitting}
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <Field label={t('accounts.username')}>
          <input className="input input-bordered w-full" value={account.username} disabled />
        </Field>
        <Field label={t('accounts.password')} error={error}>
          <input
            type="password"
            className="input input-bordered w-full"
            maxLength={32}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  )
}

function GmLevelModal({
  account,
  onClose,
  onSubmit,
}: {
  account: Account
  onClose: () => void
  onSubmit: (v: { level: number; realm: number }) => void
}) {
  const { t } = useTranslation()
  const { gmLevelLabel } = useAccountLabels()
  const [level, setLevel] = useState(account.gmlevel ?? 0)
  const [realm, setRealm] = useState('-1')
  const [errors, setErrors] = useState<{ level?: string; realm?: string }>({})

  const submit = () => {
    const rlm = Number(realm)
    const next: { level?: string; realm?: string } = {}
    if (level < 0 || level > 3) next.level = t('validation.required')
    if (realm.trim() === '' || Number.isNaN(rlm)) next.realm = t('validation.required')
    setErrors(next)
    if (next.level || next.realm) return
    onSubmit({ level, realm: rlm })
  }

  return (
    <Modal open title={t('accounts.setGm')} onClose={onClose} onOk={submit}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <Field label={t('accounts.username')}>
          <input className="input input-bordered w-full" value={account.username} disabled />
        </Field>
        <Field label={t('accounts.gmlevel')} error={errors.level}>
          <Select
            value={level}
            onChange={(v) => setLevel(Number(v ?? 0))}
            options={[0, 1, 2, 3].map((n) => ({
              value: n,
              label: `${n} · ${gmLevelLabel(n)}`,
            }))}
          />
        </Field>
        <Field label={t('accounts.realm')} error={errors.realm}>
          <input
            type="number"
            className="input input-bordered w-full"
            value={realm}
            onChange={(e) => setRealm(e.target.value)}
          />
        </Field>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  )
}

function AddonModal({
  account,
  onClose,
  onSubmit,
}: {
  account: Account
  onClose: () => void
  onSubmit: (addon: number) => void
}) {
  const { t } = useTranslation()
  const { expansionLabel } = useAccountLabels()
  const [addon, setAddon] = useState(account.expansion ?? 2)
  const [error, setError] = useState<string>()

  const submit = () => {
    if (addon < 0 || addon > 2) {
      setError(t('validation.required'))
      return
    }
    setError(undefined)
    onSubmit(addon)
  }

  return (
    <Modal open title={t('accounts.addon')} onClose={onClose} onOk={submit}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <Field label={t('accounts.addon')} error={error}>
          <Select
            value={addon}
            onChange={(v) => setAddon(Number(v ?? 2))}
            options={[0, 1, 2].map((n) => ({
              value: n,
              label: `${n} · ${expansionLabel(n)}`,
            }))}
          />
        </Field>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  )
}

function FlagsModal({
  account,
  onClose,
  onAction,
}: {
  account: Account
  onClose: () => void
  onAction: (action: string, flag: string) => void
}) {
  const { t } = useTranslation()
  const [action, setAction] = useState('list')
  const [flag, setFlag] = useState('')
  const [error, setError] = useState<string>()

  const submit = () => {
    if (action !== 'list' && !flag.trim()) {
      setError(t('validation.required'))
      return
    }
    setError(undefined)
    onAction(action, flag.trim())
  }

  return (
    <Modal open title={t('accounts.flags')} onClose={onClose} onOk={submit}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <Field label={t('accounts.username')}>
          <input className="input input-bordered w-full" value={account.username} disabled />
        </Field>
        <Field label={t('moderation.type')}>
          <Select
            value={action}
            onChange={(v) => setAction(v ?? 'list')}
            options={[
              { value: 'list', label: t('common.list') },
              { value: 'add', label: t('common.add') },
              { value: 'remove', label: t('common.remove') },
            ]}
          />
        </Field>
        {action !== 'list' && (
          <Field label={t('accounts.flag')} error={error}>
            <input
              className="input input-bordered w-full"
              value={flag}
              onChange={(e) => setFlag(e.target.value)}
            />
          </Field>
        )}
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  )
}

function PhraseConfirmModal({
  target,
  onClose,
  onConfirm,
}: {
  target: { account: Account; kind: '2fa' | 'delete' }
  onClose: () => void
  onConfirm: (phrase: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const [phrase, setPhrase] = useState('')
  const [error, setError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)
  const title = target.kind === '2fa' ? t('accounts.disable2fa') : t('accounts.delete')

  const submit = async () => {
    if (phrase !== target.account.username) {
      setError(phrase ? t('accounts.phraseMismatch') : t('validation.required'))
      return
    }
    setError(undefined)
    setSubmitting(true)
    try {
      await onConfirm(phrase)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open
      title={title}
      okDanger
      confirmLoading={submitting}
      onClose={onClose}
      onOk={submit}
    >
      <p className="mb-3">
        {target.kind === '2fa'
          ? t('accounts.disable2faConfirm', { user: target.account.username })
          : t('accounts.deleteConfirm', { user: target.account.username })}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <Field label={t('accounts.phrase')} error={error}>
          <input
            className="input input-bordered w-full"
            placeholder={target.account.username}
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            autoComplete="off"
          />
        </Field>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  )
}
