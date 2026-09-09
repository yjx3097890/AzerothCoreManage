import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, errorMessage, hasMinRole } from '../api/client'
import { ConfirmDanger } from '../components/ConfirmDanger'
import { classLabel } from '../utils/wowLabels'
import { DataTable, Select, toast, type Column } from '../ui'

type Overview = {
  account_prefix: string
  rndbot_accounts: number
  online_bots: number
  note_key?: string
  note?: string
}

type BotRow = {
  guid: number
  name: string
  account: string
  race: number
  race_name?: string
  class: number
  class_name?: string
  level: number
  map: number
  map_name?: string
  zone: number
  zone_name?: string
}

type BotGuild = { id: number; name: string; bot_members: number }

const CONFIG_KEYS = [
  'AiPlayerbot.RandomBotAutologin',
  'AiPlayerbot.MinRandomBots',
  'AiPlayerbot.MaxRandomBots',
  'AiPlayerbot.RandomBotMinLevel',
  'AiPlayerbot.RandomBotMaxLevel',
  'AiPlayerbot.DisableDeathKnightLogin',
  'AiPlayerbot.RandomBotAccountPrefix',
  'AiPlayerbot.RandomBotAccountCount',
  'AiPlayerbot.AutoGearQuality',
  'AiPlayerbot.RandomBotTimedLogout',
  'AiPlayerbot.RandomBotTimedOffline',
]

function StatCard({ title, hint, value }: { title: string; hint: string; value: string | number }) {
  return (
    <div className="card bg-base-100 border border-base-300">
      <div className="card-body p-4">
        <span className="text-sm text-base-content/60 tooltip tooltip-right w-fit" data-tip={hint}>
          {title}
        </span>
        <span className="text-2xl font-semibold">{value}</span>
      </div>
    </div>
  )
}

export function PlayerbotsPage() {
  const { t, i18n } = useTranslation()
  const [overview, setOverview] = useState<Overview | null>(null)
  const [stats, setStats] = useState('')
  const [online, setOnline] = useState<BotRow[]>([])
  const [config, setConfig] = useState<{
    available: boolean
    values?: Record<string, string>
    message?: string
  } | null>(null)
  const [guilds, setGuilds] = useState<BotGuild[]>([])
  const [accountResult, setAccountResult] = useState('')
  const [configValues, setConfigValues] = useState<Record<string, string>>({})
  const [pending, setPending] = useState<{ title: string; description: string; run: () => Promise<void> } | null>(null)

  const [levelArg, setLevelArg] = useState('')
  const [botsAction, setBotsAction] = useState('add')
  const [botsName, setBotsName] = useState('')
  const [botsAccount, setBotsAccount] = useState('')
  const [botsClass, setBotsClass] = useState('')
  const [accountAction, setAccountAction] = useState('list')
  const [accountName, setAccountName] = useState('')
  const [accountKey, setAccountKey] = useState('')

  const load = useCallback(async () => {
    try {
      const [ov, bots, conf, g] = await Promise.all([
        api<Overview>('/api/v1/playerbots/overview'),
        api<{ items: BotRow[] }>('/api/v1/playerbots/online'),
        api<{ available: boolean; values?: Record<string, string>; message?: string }>(
          '/api/v1/playerbots/config',
        ),
        api<{ items: BotGuild[] }>('/api/v1/playerbots/guilds'),
      ])
      setOverview(ov)
      setOnline(bots.items)
      setConfig(conf)
      setGuilds(g.items)
      if (conf.values) setConfigValues((prev) => ({ ...prev, ...conf.values }))
    } catch (err) {
      toast.error(errorMessage(err, t))
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load, i18n.language])

  const loadStats = async () => {
    try {
      const data = await api<{ raw: string }>('/api/v1/playerbots/stats')
      setStats(data.raw)
    } catch (err) {
      toast.error(errorMessage(err, t))
    }
  }

  const runAction = (action: string, needsConfirm: boolean, arg?: string) => {
    const exec = async () => {
      await api(`/api/v1/playerbots/rndbot/${action}`, {
        method: 'POST',
        body: JSON.stringify({ arg, confirm: true }),
      })
      await load()
      if (action === 'stats' || action === 'reload') await loadStats()
    }
    if (!needsConfirm) {
      void exec()
        .then(() => toast.success(t('common.ok')))
        .catch((err) => toast.error(errorMessage(err, t)))
      return
    }
    setPending({
      title: t('playerbots.rndbotTitle', { action }),
      description: t('playerbots.actionConfirm', { action }),
      run: exec,
    })
  }

  const botsActions = [
    { value: 'add', label: t('common.add'), hint: t('playerbots.botsAddHint') },
    { value: 'remove', label: t('common.remove'), hint: t('playerbots.botsRemoveHint') },
    { value: 'addaccount', label: t('playerbots.addAccount'), hint: t('playerbots.addAccountHint') },
    { value: 'addclass', label: t('playerbots.addClass'), hint: t('playerbots.addClassHint') },
  ]

  const accountActions = [
    { value: 'list', label: t('common.list'), hint: t('playerbots.accountListHint') },
    { value: 'link', label: t('playerbots.link'), hint: t('playerbots.linkHint') },
    { value: 'unlink', label: t('playerbots.unlink'), hint: t('playerbots.unlinkHint') },
    { value: 'setkey', label: t('playerbots.setKey'), hint: t('playerbots.setKeyHint') },
  ]

  const onlineColumns: Column<BotRow>[] = [
    { key: 'name', title: t('characters.name'), dataIndex: 'name' },
    { key: 'account', title: t('characters.account'), dataIndex: 'account' },
    { key: 'level', title: t('characters.level'), dataIndex: 'level', width: 80 },
    {
      key: 'map',
      title: t('characters.map'),
      width: 140,
      render: (_v, r) => (r.map_name ? `${r.map_name} (#${r.map})` : r.map),
    },
    {
      key: 'class',
      title: t('common.class'),
      width: 120,
      render: (_v, r) => classLabel(r.class, i18n.language, r.class_name),
    },
  ]

  const guildColumns: Column<BotGuild>[] = [
    { key: 'id', title: 'ID', dataIndex: 'id', width: 80 },
    { key: 'name', title: t('guilds.name'), dataIndex: 'name' },
    { key: 'bot_members', title: t('playerbots.botMembers'), dataIndex: 'bot_members', width: 120 },
  ]

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h1 className="text-2xl font-semibold m-0">{t('pages.playerbots.title')}</h1>
        <button type="button" className="btn btn-sm" onClick={() => void load()}>
          {t('common.refresh')}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        <StatCard
          title={t('playerbots.accounts')}
          hint={t('playerbots.accountsHint')}
          value={overview?.rndbot_accounts ?? '-'}
        />
        <StatCard
          title={t('playerbots.online')}
          hint={t('playerbots.onlineHint')}
          value={overview?.online_bots ?? '-'}
        />
        <StatCard
          title={t('playerbots.prefix')}
          hint={t('playerbots.prefixHint')}
          value={overview?.account_prefix ?? '-'}
        />
      </div>

      {(overview?.note_key === 'prefix_stats_only' || overview?.note) && (
        <div className="alert alert-info mb-4">
          <span>
            {overview?.note_key === 'prefix_stats_only' ? t('playerbots.notePrefixStats') : overview?.note}
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="tooltip" data-tip={t('playerbots.statsHint')}>
          <button type="button" className="btn btn-sm" onClick={() => void loadStats()}>
            {t('playerbots.stats')}
          </button>
        </span>
        {hasMinRole('gm') && (
          <>
            <span className="tooltip" data-tip={t('playerbots.reloadHint')}>
              <button type="button" className="btn btn-sm" onClick={() => runAction('reload', false)}>
                {t('playerbots.reload')}
              </button>
            </span>
            <span className="tooltip" data-tip={t('playerbots.refreshHint')}>
              <button type="button" className="btn btn-sm" onClick={() => runAction('refresh', true)}>
                {t('playerbots.refresh')}
              </button>
            </span>
            <span className="tooltip" data-tip={t('playerbots.teleportHint')}>
              <button type="button" className="btn btn-sm" onClick={() => runAction('teleport', true)}>
                {t('playerbots.teleport')}
              </button>
            </span>
            <span className="tooltip" data-tip={t('playerbots.initHint')}>
              <button type="button" className="btn btn-sm btn-error" onClick={() => runAction('init', true)}>
                {t('playerbots.init')}
              </button>
            </span>
            <span className="tooltip" data-tip={t('playerbots.resetHint')}>
              <button type="button" className="btn btn-sm btn-error" onClick={() => runAction('reset', true)}>
                {t('playerbots.reset')}
              </button>
            </span>
          </>
        )}
      </div>

      {hasMinRole('gm') && (
        <>
          <form
            className="flex flex-wrap items-center gap-2 mb-4"
            onSubmit={(e) => {
              e.preventDefault()
              runAction('level', true, levelArg)
            }}
          >
            <span className="tooltip" data-tip={t('playerbots.levelArgHint')}>
              <input
                className="input input-bordered input-sm w-48"
                required
                placeholder={t('playerbots.levelArg')}
                value={levelArg}
                onChange={(e) => setLevelArg(e.target.value)}
              />
            </span>
            <span className="tooltip" data-tip={t('playerbots.setLevelHint')}>
              <button type="submit" className="btn btn-sm">
                {t('playerbots.setLevel')}
              </button>
            </span>
          </form>

          <h2 className="text-base font-semibold mb-2">{t('playerbots.pmon')}</h2>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            {(
              [
                { action: 'toggle', label: t('playerbots.pmonToggle'), hint: t('playerbots.pmonToggleHint') },
                { action: 'stack', label: t('playerbots.pmonStack'), hint: t('playerbots.pmonStackHint') },
                { action: 'tick', label: t('playerbots.pmonTick'), hint: t('playerbots.pmonTickHint') },
                { action: 'reset', label: t('playerbots.pmonReset'), hint: t('playerbots.pmonResetHint') },
              ] as const
            ).map(({ action, label, hint }) => (
              <span key={action} className="tooltip" data-tip={hint}>
                <button
                  type="button"
                  className={`btn btn-sm ${action === 'toggle' || action === 'reset' ? 'btn-error' : ''}`}
                  onClick={() => {
                    const needsConfirm = action === 'toggle' || action === 'reset'
                    const exec = async () => {
                      await api('/api/v1/playerbots/pmon', {
                        method: 'POST',
                        body: JSON.stringify({ action, confirm: true }),
                      })
                    }
                    if (!needsConfirm) {
                      void exec()
                        .then(() => toast.success(t('common.ok')))
                        .catch((err) => toast.error(errorMessage(err, t)))
                      return
                    }
                    setPending({
                      title: t('playerbots.pmon'),
                      description: t('playerbots.pmonConfirm', { action }),
                      run: exec,
                    })
                  }}
                >
                  {t('playerbots.pmon')} {label}
                </button>
              </span>
            ))}
          </div>

          <h2 className="text-base font-semibold mb-2">{t('playerbots.bots')}</h2>
          <form
            className="flex flex-wrap items-center gap-2 mb-4"
            onSubmit={(e) => {
              e.preventDefault()
              const values: { action: string; name?: string; account?: string; class?: string } = {
                action: botsAction,
              }
              if (botsAction === 'add' || botsAction === 'remove') values.name = botsName
              else if (botsAction === 'addaccount') values.account = botsAccount
              else values.class = botsClass
              setPending({
                title: t('playerbots.bots'),
                description: t('playerbots.botsConfirm', {
                  action: values.action,
                  name: values.name ?? values.account ?? values.class ?? '',
                }),
                run: async () => {
                  await api('/api/v1/playerbots/bots', {
                    method: 'POST',
                    body: JSON.stringify({ ...values, confirm: true }),
                  })
                  await load()
                },
              })
            }}
          >
            <span
              className="tooltip"
              data-tip={botsActions.find((o) => o.value === botsAction)?.hint}
            >
              <Select
                className="w-36"
                value={botsAction}
                onChange={(v) => setBotsAction(v ?? 'add')}
                options={botsActions.map((o) => ({ value: o.value, label: o.label }))}
              />
            </span>
            {(botsAction === 'add' || botsAction === 'remove') && (
              <input
                className="input input-bordered w-48"
                required
                placeholder={t('characters.name')}
                value={botsName}
                onChange={(e) => setBotsName(e.target.value)}
              />
            )}
            {botsAction === 'addaccount' && (
              <input
                className="input input-bordered w-48"
                required
                placeholder={t('accounts.username')}
                value={botsAccount}
                onChange={(e) => setBotsAccount(e.target.value)}
              />
            )}
            {botsAction === 'addclass' && (
              <span className="tooltip" data-tip={t('playerbots.addClassHint')}>
                <input
                  className="input input-bordered w-48"
                  required
                  placeholder={t('common.class')}
                  value={botsClass}
                  onChange={(e) => setBotsClass(e.target.value)}
                />
              </span>
            )}
            <span className="tooltip" data-tip={t('playerbots.botsHint')}>
              <button type="submit" className="btn">
                {t('playerbots.bots')}
              </button>
            </span>
          </form>

          <h2 className="text-base font-semibold mb-2">{t('playerbots.account')}</h2>
          <form
            className="flex flex-wrap items-center gap-2 mb-4"
            onSubmit={async (e) => {
              e.preventDefault()
              const values: { action: string; account?: string; key?: string } = { action: accountAction }
              if (accountAction === 'link' || accountAction === 'unlink') values.account = accountName
              if (accountAction === 'link' || accountAction === 'setkey') values.key = accountKey
              const needsConfirm = values.action !== 'list' && values.action !== 'linkedaccounts'
              const exec = async () => {
                const resp = await api<{ result?: string; command?: string }>('/api/v1/playerbots/account', {
                  method: 'POST',
                  body: JSON.stringify({ ...values, confirm: true }),
                })
                setAccountResult(typeof resp.result === 'string' ? resp.result : JSON.stringify(resp))
              }
              if (!needsConfirm) {
                try {
                  await exec()
                  toast.success(t('common.ok'))
                } catch (err) {
                  toast.error(errorMessage(err, t))
                }
                return
              }
              setPending({
                title: t('playerbots.account'),
                description: t('playerbots.accountConfirm', { action: values.action }),
                run: exec,
              })
            }}
          >
            <span
              className="tooltip"
              data-tip={accountActions.find((o) => o.value === accountAction)?.hint}
            >
              <Select
                className="w-40"
                value={accountAction}
                onChange={(v) => setAccountAction(v ?? 'list')}
                options={accountActions.map((o) => ({ value: o.value, label: o.label }))}
              />
            </span>
            {(accountAction === 'link' || accountAction === 'unlink') && (
              <input
                className="input input-bordered w-48"
                required
                placeholder={t('accounts.username')}
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
              />
            )}
            {(accountAction === 'link' || accountAction === 'setkey') && (
              <span className="tooltip" data-tip={t('playerbots.setKeyHint')}>
                <input
                  className="input input-bordered w-48"
                  required
                  placeholder={t('common.key')}
                  value={accountKey}
                  onChange={(e) => setAccountKey(e.target.value)}
                />
              </span>
            )}
            <span className="tooltip" data-tip={t('playerbots.accountHint')}>
              <button type="submit" className="btn">
                {t('playerbots.account')}
              </button>
            </span>
          </form>
          {accountResult && (
            <div className="alert alert-success mb-4 block">
              <div className="font-semibold mb-1">{t('playerbots.account')}</div>
              <pre className="m-0 whitespace-pre-wrap text-sm">{accountResult}</pre>
            </div>
          )}
        </>
      )}

      {stats && (
        <div className="alert alert-success mb-4 block">
          <div className="font-semibold mb-1">{t('playerbots.stats')}</div>
          <pre className="m-0 whitespace-pre-wrap text-sm">{stats}</pre>
        </div>
      )}

      <h2 className="text-base font-semibold mb-2">{t('playerbots.onlineList')}</h2>
      <DataTable rowKey="guid" dataSource={online} columns={onlineColumns} pagination={{ pageSize: 20 }} />

      <h2 className="text-base font-semibold mt-6 mb-2">{t('playerbots.guilds')}</h2>
      <DataTable rowKey="id" dataSource={guilds} columns={guildColumns} pagination={{ pageSize: 10 }} />

      <h2 className="text-base font-semibold mt-6 mb-2">{t('playerbots.config')}</h2>
      {!config?.available ? (
        <div className="alert alert-info">
          <span>{config?.message || t('playerbots.configMissing')}</span>
        </div>
      ) : hasMinRole('superadmin') ? (
        <form
          className="flex flex-col gap-3 max-w-[560px]"
          onSubmit={(e) => {
            e.preventDefault()
            const updates: Record<string, string> = {}
            for (const k of CONFIG_KEYS) {
              const v = configValues[k]
              if (v != null && String(v).trim() !== '') {
                updates[k] = String(v).trim()
              }
            }
            setPending({
              title: t('playerbots.config'),
              description: t('playerbots.configConfirm'),
              run: async () => {
                await api('/api/v1/playerbots/config', {
                  method: 'PUT',
                  body: JSON.stringify({ values: updates, confirm: true, reload: true }),
                })
                await load()
              },
            })
          }}
        >
          {CONFIG_KEYS.map((key) => (
            <label key={key} className="form-control w-full">
              <span className="label-text mb-1">{key}</span>
              <input
                className="input input-bordered w-full"
                value={configValues[key] ?? ''}
                onChange={(e) => setConfigValues((prev) => ({ ...prev, [key]: e.target.value }))}
              />
            </label>
          ))}
          <div>
            <span className="tooltip" data-tip={t('playerbots.configSaveHint')}>
              <button type="submit" className="btn btn-primary">
                {t('playerbots.configSave')}
              </button>
            </span>
          </div>
        </form>
      ) : (
        <div className="overflow-x-auto rounded-box border border-base-300">
          <table className="table table-zebra table-sm">
            <tbody>
              {Object.entries(config.values ?? {}).map(([k, v]) => (
                <tr key={k}>
                  <th className="w-72">{k}</th>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
          } catch (err) {
            toast.error(errorMessage(err, t))
          }
        }}
      />
    </div>
  )
}
