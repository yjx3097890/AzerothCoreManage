import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { api, errorMessage, hasMinRole } from '../api/client'
import { ConfirmDanger } from '../components/ConfirmDanger'
import { classLabel } from '../utils/wowLabels'
import { DataTable, Select, Tabs, toast, type Column } from '../ui'

type Overview = {
  account_prefix: string
  rndbot_accounts: number
  addclass_accounts?: number
  altbot_links?: number
  online_bots: number
  online_rndbot?: number
  online_addclass?: number
  account_type_ready?: boolean
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

type ConfigControl = 'text' | 'toggle' | 'gearQuality'
type ConfigSection = 'login' | 'population' | 'accounts' | 'battleground' | 'arena'

const CONFIG_ITEMS: { key: string; id: string; control: ConfigControl; section: ConfigSection }[] = [
  // 登录
  { key: 'AiPlayerbot.RandomBotAutologin', id: 'autologin', control: 'toggle', section: 'login' },
  { key: 'AiPlayerbot.BotAutologin', id: 'botAutologin', control: 'toggle', section: 'login' },
  { key: 'AiPlayerbot.DisableDeathKnightLogin', id: 'disableDK', control: 'toggle', section: 'login' },
  // 数量与等级
  { key: 'AiPlayerbot.MinRandomBots', id: 'minBots', control: 'text', section: 'population' },
  { key: 'AiPlayerbot.MaxRandomBots', id: 'maxBots', control: 'text', section: 'population' },
  { key: 'AiPlayerbot.RandomBotMinLevel', id: 'minLevel', control: 'text', section: 'population' },
  { key: 'AiPlayerbot.RandomBotMaxLevel', id: 'maxLevel', control: 'text', section: 'population' },
  { key: 'AiPlayerbot.EnablePeriodicOnlineOffline', id: 'periodicOnlineOffline', control: 'toggle', section: 'population' },
  { key: 'AiPlayerbot.PeriodicOnlineOfflineRatio', id: 'periodicOnlineOfflineRatio', control: 'text', section: 'population' },
  // 账号与装备
  { key: 'AiPlayerbot.RandomBotAccountPrefix', id: 'accountPrefix', control: 'text', section: 'accounts' },
  { key: 'AiPlayerbot.RandomBotAccountCount', id: 'accountCount', control: 'text', section: 'accounts' },
  { key: 'AiPlayerbot.AutoGearQualityLimit', id: 'gearQuality', control: 'gearQuality', section: 'accounts' },
  // 战场
  { key: 'AiPlayerbot.RandomBotJoinBG', id: 'joinBG', control: 'toggle', section: 'battleground' },
  { key: 'AiPlayerbot.RandomBotAutoJoinBG', id: 'autoJoinBG', control: 'toggle', section: 'battleground' },
  { key: 'AiPlayerbot.RandomBotAutoJoinICBrackets', id: 'icBrackets', control: 'text', section: 'battleground' },
  { key: 'AiPlayerbot.RandomBotAutoJoinEYBrackets', id: 'eyBrackets', control: 'text', section: 'battleground' },
  { key: 'AiPlayerbot.RandomBotAutoJoinAVBrackets', id: 'avBrackets', control: 'text', section: 'battleground' },
  { key: 'AiPlayerbot.RandomBotAutoJoinABBrackets', id: 'abBrackets', control: 'text', section: 'battleground' },
  { key: 'AiPlayerbot.RandomBotAutoJoinWSBrackets', id: 'wsBrackets', control: 'text', section: 'battleground' },
  { key: 'AiPlayerbot.RandomBotAutoJoinBGICCount', id: 'icCount', control: 'text', section: 'battleground' },
  { key: 'AiPlayerbot.RandomBotAutoJoinBGEYCount', id: 'eyCount', control: 'text', section: 'battleground' },
  { key: 'AiPlayerbot.RandomBotAutoJoinBGAVCount', id: 'avCount', control: 'text', section: 'battleground' },
  { key: 'AiPlayerbot.RandomBotAutoJoinBGABCount', id: 'abCount', control: 'text', section: 'battleground' },
  { key: 'AiPlayerbot.RandomBotAutoJoinBGWSCount', id: 'wsCount', control: 'text', section: 'battleground' },
  { key: 'AiPlayerbot.FastReactInBG', id: 'fastReactInBG', control: 'toggle', section: 'battleground' },
  // 竞技场
  { key: 'AiPlayerbot.RandomBotAutoJoinArenaBracket', id: 'arenaBracket', control: 'text', section: 'arena' },
  { key: 'AiPlayerbot.RandomBotAutoJoinBGRatedArena2v2Count', id: 'arena2v2Count', control: 'text', section: 'arena' },
  { key: 'AiPlayerbot.RandomBotAutoJoinBGRatedArena3v3Count', id: 'arena3v3Count', control: 'text', section: 'arena' },
  { key: 'AiPlayerbot.RandomBotAutoJoinBGRatedArena5v5Count', id: 'arena5v5Count', control: 'text', section: 'arena' },
  { key: 'AiPlayerbot.RandomBotArenaTeam2v2Count', id: 'arenaTeam2v2', control: 'text', section: 'arena' },
  { key: 'AiPlayerbot.RandomBotArenaTeam3v3Count', id: 'arenaTeam3v3', control: 'text', section: 'arena' },
  { key: 'AiPlayerbot.RandomBotArenaTeam5v5Count', id: 'arenaTeam5v5', control: 'text', section: 'arena' },
  { key: 'AiPlayerbot.RandomBotArenaTeamMaxRating', id: 'arenaMaxRating', control: 'text', section: 'arena' },
  { key: 'AiPlayerbot.RandomBotArenaTeamMinRating', id: 'arenaMinRating', control: 'text', section: 'arena' },
  { key: 'AiPlayerbot.DeleteRandomBotArenaTeams', id: 'deleteArenaTeams', control: 'toggle', section: 'arena' },
]

const CONFIG_SECTIONS: ConfigSection[] = ['login', 'population', 'accounts', 'battleground', 'arena']

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
  const gearQualityOptions = (['1', '2', '3', '4', '5'] as const).map((v) => ({
    value: v,
    label: t(`playerbots.gearQualityOptions.${v}`),
  }))
  const toggleOptions = [
    { value: '1', label: t('playerbots.configOn') },
    { value: '0', label: t('playerbots.configOff') },
  ]
  const formatConfigValue = (item: (typeof CONFIG_ITEMS)[number], raw?: string) => {
    if (raw == null || raw === '') return '-'
    if (item.control === 'toggle') return raw === '1' ? t('playerbots.configOn') : t('playerbots.configOff')
    if (item.control === 'gearQuality') {
      const key = `playerbots.gearQualityOptions.${raw}`
      const label = t(key)
      return label === key ? raw : label
    }
    return raw
  }

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
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
                  <StatCard
                    title={t('playerbots.rndbotAccounts')}
                    desc={t('playerbots.rndbotAccountsHint')}
                    value={overview?.rndbot_accounts ?? '-'}
                  />
                  <StatCard
                    title={t('playerbots.addclassAccounts')}
                    desc={t('playerbots.addclassAccountsHint')}
                    value={overview?.addclass_accounts ?? '-'}
                  />
                  <StatCard
                    title={t('playerbots.altbotLinks')}
                    desc={t('playerbots.altbotLinksHint')}
                    value={overview?.altbot_links ?? '-'}
                  />
                  <StatCard
                    title={t('playerbots.online')}
                    desc={t('playerbots.onlineHint')}
                    value={
                      overview == null
                        ? '-'
                        : overview.account_type_ready
                          ? t('playerbots.onlineBreakdown', {
                              total: overview.online_bots,
                              rnd: overview.online_rndbot ?? 0,
                              addclass: overview.online_addclass ?? 0,
                            })
                          : overview.online_bots
                    }
                  />
                  <StatCard
                    title={t('playerbots.prefix')}
                    desc={t('playerbots.prefixHint')}
                    value={overview?.account_prefix ?? '-'}
                  />
                </div>

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
                <div className="alert alert-warning mb-4 max-w-3xl">
                  <span>{t('playerbots.ingameOnlyAlert')}</span>
                </div>
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
                        let cmd = ''
                        if (botsAction === 'add') cmd = `.playerbots bot add ${botsName.trim()}`
                        else if (botsAction === 'remove') cmd = `.playerbots bot remove ${botsName.trim()}`
                        else if (botsAction === 'addaccount') cmd = `.playerbots bot addaccount ${botsAccount.trim()}`
                        else cmd = `.playerbots bot addclass ${botsClass.trim()}`
                        setAccountResult(cmd)
                        void navigator.clipboard?.writeText(cmd).then(
                          () => toast.success(t('playerbots.commandCopied')),
                          () => toast.success(t('playerbots.commandReady')),
                        )
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
                        {t('playerbots.copyCommand')}
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
                      onSubmit={(e) => {
                        e.preventDefault()
                        let cmd = ''
                        if (accountAction === 'list' || accountAction === 'linkedaccounts') {
                          cmd = '.playerbots account linkedAccounts'
                        } else if (accountAction === 'link') {
                          cmd = `.playerbots account link ${accountName.trim()} ${accountKey.trim()}`
                        } else if (accountAction === 'unlink') {
                          cmd = `.playerbots account unlink ${accountName.trim()}`
                        } else {
                          cmd = `.playerbots account setKey ${accountKey.trim()}`
                        }
                        setAccountResult(cmd)
                        void navigator.clipboard?.writeText(cmd).then(
                          () => toast.success(t('playerbots.commandCopied')),
                          () => toast.success(t('playerbots.commandReady')),
                        )
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
                        {t('playerbots.copyCommand')}
                      </button>
                    </form>
                    {accountResult && (
                      <div className="alert alert-info block">
                        <div className="font-semibold mb-1">{t('playerbots.ingameCommand')}</div>
                        <pre className="m-0 whitespace-pre-wrap text-sm font-mono">{accountResult}</pre>
                      </div>
                    )}
                  </section>
                </div>
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
                    className="flex flex-col gap-6 max-w-[640px]"
                    onSubmit={(e) => {
                      e.preventDefault()
                      const updates: Record<string, string> = {}
                      for (const item of CONFIG_ITEMS) {
                        const raw = configValues[item.key]
                        if (item.control === 'toggle') {
                          updates[item.key] = raw === '1' ? '1' : '0'
                          continue
                        }
                        if (item.control === 'gearQuality') {
                          const v = String(raw ?? '').trim()
                          updates[item.key] = ['1', '2', '3', '4', '5'].includes(v) ? v : '3'
                          continue
                        }
                        if (raw != null && String(raw).trim() !== '') {
                          updates[item.key] = String(raw).trim()
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
                    {CONFIG_SECTIONS.map((section) => (
                      <section
                        key={section}
                        className="flex flex-col gap-4 rounded-lg border border-base-300 bg-base-100 p-4"
                      >
                        <div>
                          <h3 className="text-sm font-semibold m-0">{t(`playerbots.configSections.${section}.title`)}</h3>
                          <p className="text-xs text-base-content/55 m-0 mt-1 leading-relaxed">
                            {t(`playerbots.configSections.${section}.hint`)}
                          </p>
                        </div>
                        {CONFIG_ITEMS.filter((item) => item.section === section).map((item) => (
                          <label key={item.key} className="form-control w-full">
                            <span className="label-text font-medium mb-0.5">
                              {configLabel(item.id)}
                              <span className="text-base-content/45 font-normal"> — {configDesc(item.id)}</span>
                            </span>
                            <span className="text-[11px] font-mono text-base-content/40 mb-1">{item.key}</span>
                            {item.control === 'toggle' ? (
                              <Select
                                className="w-full"
                                value={configValues[item.key] === '1' ? '1' : '0'}
                                onChange={(v) =>
                                  setConfigValues((prev) => ({ ...prev, [item.key]: v ?? '0' }))
                                }
                                options={toggleOptions}
                              />
                            ) : item.control === 'gearQuality' ? (
                              <Select
                                className="w-full"
                                value={configValues[item.key] || '3'}
                                onChange={(v) =>
                                  setConfigValues((prev) => ({ ...prev, [item.key]: v ?? '3' }))
                                }
                                options={gearQualityOptions}
                              />
                            ) : (
                              <input
                                className="input input-bordered w-full"
                                value={configValues[item.key] ?? ''}
                                onChange={(e) =>
                                  setConfigValues((prev) => ({ ...prev, [item.key]: e.target.value }))
                                }
                              />
                            )}
                          </label>
                        ))}
                      </section>
                    ))}
                    <div>
                      <button type="submit" className="btn btn-primary btn-sm">
                        {t('playerbots.configSave')}
                      </button>
                      <p className="text-xs text-base-content/55 m-0 mt-2">{t('playerbots.configSaveHint')}</p>
                    </div>
                  </form>
                ) : (
                  <div className="flex flex-col gap-6 max-w-4xl">
                    {CONFIG_SECTIONS.map((section) => (
                      <section key={section} className="rounded-lg border border-base-300 bg-base-100 p-4">
                        <h3 className="text-sm font-semibold m-0 mb-1">{t(`playerbots.configSections.${section}.title`)}</h3>
                        <p className="text-xs text-base-content/55 m-0 mb-3 leading-relaxed">
                          {t(`playerbots.configSections.${section}.hint`)}
                        </p>
                        <div className="overflow-x-auto rounded-box border border-base-300">
                          <table className="table table-zebra table-sm">
                            <thead>
                              <tr>
                                <th>{t('playerbots.configColName')}</th>
                                <th>{t('playerbots.configColValue')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {CONFIG_ITEMS.filter((item) => item.section === section).map((item) => (
                                <tr key={item.key}>
                                  <td>
                                    <div className="font-medium">{configLabel(item.id)}</div>
                                    <div className="text-xs text-base-content/55">{configDesc(item.id)}</div>
                                    <div className="text-[11px] font-mono text-base-content/40">{item.key}</div>
                                  </td>
                                  <td className="align-top">{formatConfigValue(item, config?.values?.[item.key])}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </section>
                    ))}
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
