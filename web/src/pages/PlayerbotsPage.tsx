import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { api, errorMessage, hasMinRole } from '../api/client'
import { ConfirmDanger } from '../components/ConfirmDanger'
import { classLabel } from '../utils/wowLabels'
import { DataTable, Select, Tabs, toast, type Column } from '../ui'

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

const CONFIG_ITEMS = [
  { key: 'AiPlayerbot.RandomBotAutologin', id: 'autologin' },
  { key: 'AiPlayerbot.MinRandomBots', id: 'minBots' },
  { key: 'AiPlayerbot.MaxRandomBots', id: 'maxBots' },
  { key: 'AiPlayerbot.RandomBotMinLevel', id: 'minLevel' },
  { key: 'AiPlayerbot.RandomBotMaxLevel', id: 'maxLevel' },
  { key: 'AiPlayerbot.DisableDeathKnightLogin', id: 'disableDK' },
  { key: 'AiPlayerbot.RandomBotAccountPrefix', id: 'accountPrefix' },
  { key: 'AiPlayerbot.RandomBotAccountCount', id: 'accountCount' },
  { key: 'AiPlayerbot.AutoGearQuality', id: 'gearQuality' },
  { key: 'AiPlayerbot.RandomBotTimedLogout', id: 'timedLogout' },
  { key: 'AiPlayerbot.RandomBotTimedOffline', id: 'timedOffline' },
] as const

function StatCard({ title, desc, value }: { title: string; desc: string; value: string | number }) {
  return (
    <div className="card bg-base-100 border border-base-300">
      <div className="card-body p-4 gap-1">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-base-content/55 leading-relaxed">{desc}</span>
        <span className="text-2xl font-semibold mt-1">{value}</span>
      </div>
    </div>
  )
}

function PanelIntro({ children }: { children: ReactNode }) {
  return <p className="text-sm text-base-content/65 m-0 mb-4 leading-relaxed max-w-3xl">{children}</p>
}

export function PlayerbotsPage() {
  const { t, i18n } = useTranslation()
  const [tab, setTab] = useState('overview')
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

  const configLabel = (id: string) => t(`playerbots.configKeys.${id}.label`)
  const configDesc = (id: string) => t(`playerbots.configKeys.${id}.desc`)

  const gm = hasMinRole('gm')

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h1 className="text-2xl font-semibold m-0">{t('pages.playerbots.title')}</h1>
        <button type="button" className="btn btn-sm" onClick={() => void load()}>
          {t('common.refresh')}
        </button>
      </div>

      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: 'overview',
            label: t('playerbots.tabOverview'),
            children: (
              <div>
                <PanelIntro>{t('playerbots.overviewHint')}</PanelIntro>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                  <StatCard
                    title={t('playerbots.accounts')}
                    desc={t('playerbots.accountsHint')}
                    value={overview?.rndbot_accounts ?? '-'}
                  />
                  <StatCard
                    title={t('playerbots.online')}
                    desc={t('playerbots.onlineHint')}
                    value={overview?.online_bots ?? '-'}
                  />
                  <StatCard
                    title={t('playerbots.prefix')}
                    desc={t('playerbots.prefixHint')}
                    value={overview?.account_prefix ?? '-'}
                  />
                </div>

                {(overview?.note_key === 'prefix_stats_only' || overview?.note) && (
                  <div className="alert alert-info mb-4">
                    <span>
                      {overview?.note_key === 'prefix_stats_only'
                        ? t('playerbots.notePrefixStats')
                        : overview?.note}
                    </span>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <button type="button" className="btn btn-sm" onClick={() => void loadStats()}>
                    {t('playerbots.stats')}
                  </button>
                  <span className="text-xs text-base-content/55">{t('playerbots.statsHint')}</span>
                </div>
                {stats && (
                  <div className="alert alert-success block">
                    <div className="font-semibold mb-1">{t('playerbots.stats')}</div>
                    <pre className="m-0 whitespace-pre-wrap text-sm">{stats}</pre>
                  </div>
                )}
              </div>
            ),
          },
          {
            key: 'rndbot',
            label: t('playerbots.tabRndbot'),
            children: (
              <div>
                <PanelIntro>{t('playerbots.rndbotHint')}</PanelIntro>
                {!gm ? (
                  <p className="text-sm text-base-content/50 m-0">{t('playerbots.gmOnly')}</p>
                ) : (
                  <div className="space-y-6 max-w-3xl">
                    <section className="space-y-2">
                      <h3 className="text-sm font-semibold m-0">{t('playerbots.rndbotOps')}</h3>
                      <p className="text-xs text-base-content/55 m-0">{t('playerbots.rndbotOpsHint')}</p>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className="btn btn-sm" onClick={() => runAction('reload', false)}>
                          {t('playerbots.reload')}
                        </button>
                        <button type="button" className="btn btn-sm" onClick={() => runAction('refresh', true)}>
                          {t('playerbots.refresh')}
                        </button>
                        <button type="button" className="btn btn-sm" onClick={() => runAction('teleport', true)}>
                          {t('playerbots.teleport')}
                        </button>
                        <button type="button" className="btn btn-sm btn-error" onClick={() => runAction('init', true)}>
                          {t('playerbots.init')}
                        </button>
                        <button type="button" className="btn btn-sm btn-error" onClick={() => runAction('reset', true)}>
                          {t('playerbots.reset')}
                        </button>
                      </div>
                      <ul className="text-xs text-base-content/55 m-0 pl-4 list-disc space-y-1">
                        <li>{t('playerbots.reloadHint')}</li>
                        <li>{t('playerbots.refreshHint')}</li>
                        <li>{t('playerbots.teleportHint')}</li>
                        <li>{t('playerbots.initHint')}</li>
                        <li>{t('playerbots.resetHint')}</li>
                      </ul>
                    </section>

                    <section className="space-y-2 pt-4 border-t border-base-300">
                      <h3 className="text-sm font-semibold m-0">{t('playerbots.setLevel')}</h3>
                      <p className="text-xs text-base-content/55 m-0">{t('playerbots.setLevelHint')}</p>
                      <form
                        className="flex flex-wrap items-center gap-2"
                        onSubmit={(e) => {
                          e.preventDefault()
                          runAction('level', true, levelArg)
                        }}
                      >
                        <input
                          className="input input-bordered input-sm w-48"
                          required
                          placeholder={t('playerbots.levelArg')}
                          value={levelArg}
                          onChange={(e) => setLevelArg(e.target.value)}
                        />
                        <button type="submit" className="btn btn-sm">
                          {t('playerbots.setLevel')}
                        </button>
                      </form>
                      <p className="text-xs text-base-content/45 m-0">{t('playerbots.levelArgHint')}</p>
                    </section>

                    <section className="space-y-2 pt-4 border-t border-base-300">
                      <h3 className="text-sm font-semibold m-0">{t('playerbots.pmon')}</h3>
                      <p className="text-xs text-base-content/55 m-0">{t('playerbots.pmonHint')}</p>
                      <div className="flex flex-wrap gap-2">
                        {(
                          [
                            { action: 'toggle', label: t('playerbots.pmonToggle'), hint: t('playerbots.pmonToggleHint') },
                            { action: 'stack', label: t('playerbots.pmonStack'), hint: t('playerbots.pmonStackHint') },
                            { action: 'tick', label: t('playerbots.pmonTick'), hint: t('playerbots.pmonTickHint') },
                            { action: 'reset', label: t('playerbots.pmonReset'), hint: t('playerbots.pmonResetHint') },
                          ] as const
                        ).map(({ action, label, hint }) => (
                          <button
                            key={action}
                            type="button"
                            title={hint}
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
                            {label}
                          </button>
                        ))}
                      </div>
                    </section>
                  </div>
                )}
              </div>
            ),
          },
          {
            key: 'bots',
            label: t('playerbots.tabBots'),
            children: (
              <div>
                <PanelIntro>{t('playerbots.botsTabHint')}</PanelIntro>
                {!gm ? (
                  <p className="text-sm text-base-content/50 m-0">{t('playerbots.gmOnly')}</p>
                ) : (
                  <div className="space-y-6 max-w-3xl">
                    <section className="space-y-2">
                      <h3 className="text-sm font-semibold m-0">{t('playerbots.bots')}</h3>
                      <p className="text-xs text-base-content/55 m-0">
                        {botsActions.find((o) => o.value === botsAction)?.hint}
                      </p>
                      <form
                        className="flex flex-wrap items-center gap-2"
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
                        <Select
                          className="w-36"
                          value={botsAction}
                          onChange={(v) => setBotsAction(v ?? 'add')}
                          options={botsActions.map((o) => ({ value: o.value, label: o.label }))}
                        />
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
                          <input
                            className="input input-bordered w-48"
                            required
                            placeholder={t('common.class')}
                            value={botsClass}
                            onChange={(e) => setBotsClass(e.target.value)}
                          />
                        )}
                        <button type="submit" className="btn btn-sm btn-primary">
                          {t('playerbots.bots')}
                        </button>
                      </form>
                    </section>

                    <section className="space-y-2 pt-4 border-t border-base-300">
                      <h3 className="text-sm font-semibold m-0">{t('playerbots.account')}</h3>
                      <p className="text-xs text-base-content/55 m-0">
                        {accountActions.find((o) => o.value === accountAction)?.hint}
                      </p>
                      <form
                        className="flex flex-wrap items-center gap-2"
                        onSubmit={async (e) => {
                          e.preventDefault()
                          const values: { action: string; account?: string; key?: string } = { action: accountAction }
                          if (accountAction === 'link' || accountAction === 'unlink') values.account = accountName
                          if (accountAction === 'link' || accountAction === 'setkey') values.key = accountKey
                          const needsConfirm = values.action !== 'list' && values.action !== 'linkedaccounts'
                          const exec = async () => {
                            const resp = await api<{ result?: string; command?: string }>(
                              '/api/v1/playerbots/account',
                              {
                                method: 'POST',
                                body: JSON.stringify({ ...values, confirm: true }),
                              },
                            )
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
                        <Select
                          className="w-40"
                          value={accountAction}
                          onChange={(v) => setAccountAction(v ?? 'list')}
                          options={accountActions.map((o) => ({ value: o.value, label: o.label }))}
                        />
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
                          <input
                            className="input input-bordered w-48"
                            required
                            placeholder={t('common.key')}
                            value={accountKey}
                            onChange={(e) => setAccountKey(e.target.value)}
                          />
                        )}
                        <button type="submit" className="btn btn-sm btn-primary">
                          {t('playerbots.account')}
                        </button>
                      </form>
                      {accountResult && (
                        <div className="alert alert-success block">
                          <div className="font-semibold mb-1">{t('playerbots.account')}</div>
                          <pre className="m-0 whitespace-pre-wrap text-sm">{accountResult}</pre>
                        </div>
                      )}
                    </section>
                  </div>
                )}
              </div>
            ),
          },
          {
            key: 'online',
            label: t('playerbots.tabOnline'),
            children: (
              <div>
                <PanelIntro>{t('playerbots.onlineTabHint')}</PanelIntro>
                <DataTable rowKey="guid" dataSource={online} columns={onlineColumns} pagination={{ pageSize: 20 }} />
              </div>
            ),
          },
          {
            key: 'guilds',
            label: t('playerbots.tabGuilds'),
            children: (
              <div>
                <PanelIntro>{t('playerbots.guildsTabHint')}</PanelIntro>
                <DataTable rowKey="id" dataSource={guilds} columns={guildColumns} pagination={{ pageSize: 10 }} />
              </div>
            ),
          },
          {
            key: 'config',
            label: t('playerbots.tabConfig'),
            children: (
              <div>
                <PanelIntro>{t('playerbots.configTabHint')}</PanelIntro>
                {!config?.available ? (
                  <div className="alert alert-info">
                    <span>{config?.message || t('playerbots.configMissing')}</span>
                  </div>
                ) : hasMinRole('superadmin') ? (
                  <form
                    className="flex flex-col gap-4 max-w-[640px]"
                    onSubmit={(e) => {
                      e.preventDefault()
                      const updates: Record<string, string> = {}
                      for (const item of CONFIG_ITEMS) {
                        const v = configValues[item.key]
                        if (v != null && String(v).trim() !== '') {
                          updates[item.key] = String(v).trim()
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
                    {CONFIG_ITEMS.map((item) => (
                      <label key={item.key} className="form-control w-full">
                        <span className="label-text font-medium mb-0.5">
                          {configLabel(item.id)}
                          <span className="text-base-content/45 font-normal"> — {configDesc(item.id)}</span>
                        </span>
                        <span className="text-[11px] font-mono text-base-content/40 mb-1">{item.key}</span>
                        <input
                          className="input input-bordered w-full"
                          value={configValues[item.key] ?? ''}
                          onChange={(e) => setConfigValues((prev) => ({ ...prev, [item.key]: e.target.value }))}
                        />
                      </label>
                    ))}
                    <div>
                      <button type="submit" className="btn btn-primary btn-sm">
                        {t('playerbots.configSave')}
                      </button>
                      <p className="text-xs text-base-content/55 m-0 mt-2">{t('playerbots.configSaveHint')}</p>
                    </div>
                  </form>
                ) : (
                  <div className="overflow-x-auto rounded-box border border-base-300 max-w-4xl">
                    <table className="table table-zebra table-sm">
                      <thead>
                        <tr>
                          <th>{t('playerbots.configColName')}</th>
                          <th>{t('playerbots.configColValue')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {CONFIG_ITEMS.map((item) => (
                          <tr key={item.key}>
                            <td>
                              <div className="font-medium">{configLabel(item.id)}</div>
                              <div className="text-xs text-base-content/55">{configDesc(item.id)}</div>
                              <div className="text-[11px] font-mono text-base-content/40">{item.key}</div>
                            </td>
                            <td className="align-top">{config?.values?.[item.key] ?? '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ),
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
