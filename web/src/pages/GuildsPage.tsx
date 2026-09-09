import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, errorMessage, hasMinRole } from '../api/client'
import { ConfirmDanger } from '../components/ConfirmDanger'
import { DataTable, Drawer, Select, Tabs, toast, type Column, type TabItem } from '../ui'

type GuildMember = { guid: number; name: string; rank: number; rank_name: string }

type Guild = {
  id: number
  name: string
  leader_name: string
  bank_money: number
  motd: string
  members?: GuildMember[]
}

type BankItem = {
  tab: number
  slot: number
  item_guid: number
  item_entry: number
  count: number
  name: string
}

type BankData = {
  guild_id: number
  tabs: { tab: number; name: string }[]
  items: BankItem[]
}

type ArenaTeam = {
  id: number
  name: string
  captain_name: string
  type: number
  rating: number
  season_games: number
  season_wins: number
  week_games: number
  week_wins: number
  rank: number
}

type ArenaMember = {
  guid: number
  name: string
  week_games: number
  week_wins: number
  season_games: number
  season_wins: number
  personal_rating: number
}

type GroupRow = {
  guid: number
  leader_name: string
  group_type: number
  difficulty: number
  raid_difficulty: number
  members: number
}

type GroupMember = {
  guid: number
  name: string
  flags: number
  subgroup: number
  roles: number
  online: number
}

export function GuildsPage() {
  const { t } = useTranslation()
  const [mainTab, setMainTab] = useState('guilds')
  const [q, setQ] = useState('')
  const [items, setItems] = useState<Guild[]>([])
  const [loading, setLoading] = useState(false)
  const [detail, setDetail] = useState<Guild | null>(null)
  const [bank, setBank] = useState<BankData | null>(null)
  const [bankLoading, setBankLoading] = useState(false)
  const [pending, setPending] = useState<{ title: string; description: string; run: () => Promise<void> } | null>(
    null,
  )
  const [createLeader, setCreateLeader] = useState('')
  const [createGuild, setCreateGuild] = useState('')
  const [renameName, setRenameName] = useState('')

  const [arenaQ, setArenaQ] = useState('')
  const [arenaItems, setArenaItems] = useState<ArenaTeam[]>([])
  const [arenaSeason, setArenaSeason] = useState<{ season_id?: number; season_state?: number }>({})
  const [arenaLoading, setArenaLoading] = useState(false)
  const [arenaDetail, setArenaDetail] = useState<{ id: number; members: ArenaMember[] } | null>(null)
  const [seasonAction, setSeasonAction] = useState('start')
  const [seasonId, setSeasonId] = useState<number | undefined>(undefined)
  const [seasonState, setSeasonState] = useState<number | undefined>(undefined)

  const [groups, setGroups] = useState<GroupRow[]>([])
  const [groupsLoading, setGroupsLoading] = useState(false)
  const [groupDetail, setGroupDetail] = useState<{ guid: number; members: GroupMember[] } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '100' })
      if (q.trim()) params.set('q', q.trim())
      const data = await api<{ items: Guild[] }>(`/api/v1/guilds?${params}`)
      setItems(data.items)
    } catch (err) {
      toast.error(errorMessage(err, t))
    } finally {
      setLoading(false)
    }
  }, [q, t])

  const loadArena = useCallback(async () => {
    setArenaLoading(true)
    try {
      const params = new URLSearchParams({ limit: '100' })
      if (arenaQ.trim()) params.set('q', arenaQ.trim())
      const data = await api<{ items: ArenaTeam[]; season?: { season_id?: number; season_state?: number } }>(
        `/api/v1/arena/teams?${params}`,
      )
      setArenaItems(data.items)
      setArenaSeason(data.season ?? {})
    } catch (err) {
      toast.error(errorMessage(err, t))
    } finally {
      setArenaLoading(false)
    }
  }, [arenaQ, t])

  const loadGroups = useCallback(async () => {
    setGroupsLoading(true)
    try {
      const data = await api<{ items: GroupRow[] }>('/api/v1/groups?limit=100')
      setGroups(data.items)
    } catch (err) {
      toast.error(errorMessage(err, t))
    } finally {
      setGroupsLoading(false)
    }
  }, [t])

  useEffect(() => {
    if (mainTab === 'guilds') void load()
    if (mainTab === 'arena') void loadArena()
    if (mainTab === 'groups') void loadGroups()
  }, [mainTab, load, loadArena, loadGroups])

  const openDetail = async (id: number) => {
    try {
      setDetail(await api<Guild>(`/api/v1/guilds/${id}`))
      setBank(null)
      setBankLoading(true)
      try {
        setBank(await api<BankData>(`/api/v1/guilds/${id}/bank`))
      } catch (err) {
        toast.error(errorMessage(err, t))
      } finally {
        setBankLoading(false)
      }
    } catch (err) {
      toast.error(errorMessage(err, t))
    }
  }

  const openArena = async (id: number) => {
    try {
      setArenaDetail(await api<{ id: number; members: ArenaMember[] }>(`/api/v1/arena/teams/${id}`))
    } catch (err) {
      toast.error(errorMessage(err, t))
    }
  }

  const openGroup = async (id: number) => {
    try {
      setGroupDetail(await api<{ guid: number; members: GroupMember[] }>(`/api/v1/groups/${id}`))
    } catch (err) {
      toast.error(errorMessage(err, t))
    }
  }

  const guildColumns: Column<Guild>[] = [
    { key: 'id', title: 'ID', dataIndex: 'id', width: 80 },
    { key: 'name', title: t('guilds.name'), dataIndex: 'name' },
    { key: 'leader_name', title: t('guilds.leader'), dataIndex: 'leader_name' },
    { key: 'bank_money', title: t('guilds.bank'), dataIndex: 'bank_money' },
    {
      key: 'actions',
      title: t('common.actions'),
      render: (_v, row) => (
        <button type="button" className="btn btn-xs" onClick={() => void openDetail(row.id)}>
          {t('guilds.members')}
        </button>
      ),
    },
  ]

  const arenaColumns: Column<ArenaTeam>[] = [
    { key: 'id', title: 'ID', dataIndex: 'id', width: 70 },
    { key: 'name', title: t('guilds.name'), dataIndex: 'name' },
    { key: 'captain_name', title: t('guilds.captain'), dataIndex: 'captain_name' },
    { key: 'type', title: t('guilds.arenaType'), dataIndex: 'type', width: 70 },
    { key: 'rating', title: t('guilds.rating'), dataIndex: 'rating', width: 90 },
    { key: 'rank', title: t('guilds.rank'), dataIndex: 'rank', width: 70 },
    {
      key: 'actions',
      title: t('common.actions'),
      render: (_v, row) => (
        <button type="button" className="btn btn-xs" onClick={() => void openArena(row.id)}>
          {t('guilds.members')}
        </button>
      ),
    },
  ]

  const groupColumns: Column<GroupRow>[] = [
    { key: 'guid', title: 'GUID', dataIndex: 'guid', width: 90 },
    { key: 'leader_name', title: t('guilds.leader'), dataIndex: 'leader_name' },
    { key: 'group_type', title: t('guilds.groupType'), dataIndex: 'group_type', width: 90 },
    { key: 'members', title: t('guilds.members'), dataIndex: 'members', width: 90 },
    {
      key: 'actions',
      title: t('common.actions'),
      render: (_v, row) => (
        <button type="button" className="btn btn-xs" onClick={() => void openGroup(row.guid)}>
          {t('guilds.members')}
        </button>
      ),
    },
  ]

  const mainTabs: TabItem[] = [
    {
      key: 'guilds',
      label: t('guilds.tabGuilds'),
      children: (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <input
              className="input input-bordered input-sm w-56"
              placeholder={t('guilds.search')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void load()
              }}
            />
            <button type="button" className="btn btn-sm" onClick={() => void load()}>
              {t('common.refresh')}
            </button>
          </div>

          {hasMinRole('gm') && (
            <form
              className="flex flex-wrap items-center gap-2 mb-4"
              onSubmit={(e) => {
                e.preventDefault()
                const leader = createLeader.trim()
                const guild = createGuild.trim()
                if (!leader || !guild) {
                  toast.error(t('validation.required'))
                  return
                }
                setPending({
                  title: t('guilds.create'),
                  description: t('guilds.createConfirm', { leader, guild }),
                  run: async () => {
                    await api('/api/v1/guilds/action', {
                      method: 'POST',
                      body: JSON.stringify({
                        action: 'create',
                        leader,
                        guild,
                        confirm: true,
                      }),
                    })
                    setCreateLeader('')
                    setCreateGuild('')
                  },
                })
              }}
            >
              <label className="flex items-center gap-2 text-sm">
                <span>{t('guilds.leader')}</span>
                <input
                  className="input input-bordered input-sm w-36"
                  value={createLeader}
                  onChange={(e) => setCreateLeader(e.target.value)}
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <span>{t('guilds.name')}</span>
                <input
                  className="input input-bordered input-sm w-40"
                  value={createGuild}
                  onChange={(e) => setCreateGuild(e.target.value)}
                />
              </label>
              <button type="submit" className="btn btn-sm btn-primary">
                {t('guilds.create')}
              </button>
            </form>
          )}

          <DataTable loading={loading} rowKey="id" dataSource={items} columns={guildColumns} />
        </>
      ),
    },
    {
      key: 'arena',
      label: t('guilds.arena'),
      children: (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="input input-bordered input-sm w-56"
              placeholder={t('guilds.arenaSearch')}
              value={arenaQ}
              onChange={(e) => setArenaQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void loadArena()
              }}
            />
            <button type="button" className="btn btn-sm" onClick={() => void loadArena()}>
              {t('common.refresh')}
            </button>
            <span className="text-sm text-base-content/60">
              {t('guilds.season')}: {arenaSeason.season_id ?? '-'} / {t('guilds.seasonState')}:{' '}
              {arenaSeason.season_state ?? '-'}
            </span>
          </div>

          {hasMinRole('superadmin') && (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (!seasonAction) {
                  toast.error(t('validation.required'))
                  return
                }
                if (seasonAction === 'start' && seasonId == null) {
                  toast.error(t('validation.required'))
                  return
                }
                if (seasonAction === 'set_state' && seasonState == null) {
                  toast.error(t('validation.required'))
                  return
                }
                setPending({
                  title: t('guilds.arenaSeason'),
                  description: t('guilds.arenaSeasonConfirm', {
                    action: seasonAction,
                    id: seasonId ?? '',
                    state: seasonState ?? '',
                  }),
                  run: async () => {
                    await api('/api/v1/arena/season', {
                      method: 'POST',
                      body: JSON.stringify({
                        action: seasonAction,
                        id: seasonId,
                        state: seasonState,
                        confirm: true,
                      }),
                    })
                    await loadArena()
                  },
                })
              }}
            >
              <div className="w-40">
                <Select
                  className="select-sm"
                  value={seasonAction}
                  onChange={(v) => setSeasonAction(v ?? '')}
                  options={[
                    { value: 'start', label: t('common.start') },
                    { value: 'set_state', label: t('guilds.seasonSetState') },
                    { value: 'reward', label: t('guilds.seasonReward') },
                    { value: 'deleteteams', label: t('guilds.seasonDeleteTeams') },
                  ]}
                />
              </div>
              {seasonAction === 'start' ? (
                <input
                  type="number"
                  min={1}
                  className="input input-bordered input-sm w-36"
                  placeholder={t('guilds.seasonId')}
                  value={seasonId ?? ''}
                  onChange={(e) => setSeasonId(e.target.value === '' ? undefined : Number(e.target.value))}
                />
              ) : seasonAction === 'set_state' ? (
                <div className="w-24">
                  <Select
                    className="select-sm"
                    value={seasonState}
                    onChange={(v) => setSeasonState(v)}
                    options={[
                      { value: 0, label: '0' },
                      { value: 1, label: '1' },
                    ]}
                  />
                </div>
              ) : null}
              <button type="submit" className="btn btn-sm btn-error">
                {t('guilds.arenaSeason')}
              </button>
            </form>
          )}

          <DataTable loading={arenaLoading} rowKey="id" dataSource={arenaItems} columns={arenaColumns} />
        </div>
      ),
    },
    {
      key: 'groups',
      label: t('guilds.groups'),
      children: (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <button type="button" className="btn btn-sm" onClick={() => void loadGroups()}>
              {t('common.refresh')}
            </button>
            <span className="text-sm text-base-content/60">{t('guilds.groupsReadonly')}</span>
          </div>
          <DataTable loading={groupsLoading} rowKey="guid" dataSource={groups} columns={groupColumns} />
        </>
      ),
    },
  ]

  const detailTabs: TabItem[] = detail
    ? [
        {
          key: 'members',
          label: t('guilds.members'),
          children: (
            <DataTable
              rowKey="guid"
              dataSource={detail.members ?? []}
              pagination={false}
              columns={[
                { key: 'name', title: t('characters.name'), dataIndex: 'name' },
                { key: 'rank_name', title: t('guilds.rank'), dataIndex: 'rank_name' },
                {
                  key: 'actions',
                  title: t('common.actions'),
                  render: (_v, m) =>
                    hasMinRole('gm') ? (
                      <button
                        type="button"
                        className="btn btn-xs"
                        disabled={m.rank === 0}
                        onClick={() =>
                          setPending({
                            title: t('guilds.setLeader'),
                            description: t('guilds.leaderConfirm', { player: m.name }),
                            run: async () => {
                              await api('/api/v1/guilds/action', {
                                method: 'POST',
                                body: JSON.stringify({
                                  action: 'rank',
                                  player: m.name,
                                  rank: 0,
                                  confirm: true,
                                }),
                              })
                              void openDetail(detail.id)
                            },
                          })
                        }
                      >
                        {t('guilds.setLeader')}
                      </button>
                    ) : null,
                },
              ]}
            />
          ),
        },
        {
          key: 'bank',
          label: t('guilds.bankItems'),
          children: (
            <DataTable
              loading={bankLoading}
              rowKey={(r) => `${r.tab}-${r.slot}-${r.item_guid}`}
              dataSource={bank?.items ?? []}
              pagination={{ pageSize: 20 }}
              columns={[
                { key: 'tab', title: t('guilds.tab'), dataIndex: 'tab', width: 70 },
                { key: 'slot', title: t('common.slot'), dataIndex: 'slot', width: 70 },
                { key: 'item_entry', title: t('characters.itemEntry'), dataIndex: 'item_entry', width: 90 },
                { key: 'name', title: t('characters.itemName'), dataIndex: 'name' },
                { key: 'count', title: t('mail.count'), dataIndex: 'count', width: 70 },
              ]}
            />
          ),
        },
      ]
    : []

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-xl font-semibold m-0">{t('pages.guilds.title')}</h2>
      </div>

      <Tabs items={mainTabs} activeKey={mainTab} onChange={setMainTab} />

      <Drawer
        open={!!detail}
        width={640}
        title={detail?.name}
        onClose={() => {
          setDetail(null)
          setBank(null)
          setRenameName('')
        }}
      >
        {detail && (
          <div className="flex flex-col gap-4">
            {hasMinRole('gm') && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="btn btn-sm btn-error"
                  onClick={() =>
                    setPending({
                      title: t('guilds.disband'),
                      description: t('guilds.disbandConfirm', { guild: detail.name }),
                      run: async () => {
                        await api('/api/v1/guilds/action', {
                          method: 'POST',
                          body: JSON.stringify({ action: 'disband', guild: detail.name, confirm: true }),
                        })
                        setDetail(null)
                      },
                    })
                  }
                >
                  {t('guilds.disband')}
                </button>
                <form
                  className="flex flex-wrap items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    const newName = renameName.trim()
                    if (!newName) {
                      toast.error(t('validation.required'))
                      return
                    }
                    setPending({
                      title: t('guilds.rename'),
                      description: t('guilds.renameConfirm', {
                        guild: detail.name,
                        newName,
                      }),
                      run: async () => {
                        await api('/api/v1/guilds/action', {
                          method: 'POST',
                          body: JSON.stringify({
                            action: 'rename',
                            guild: detail.name,
                            new_name: newName,
                            confirm: true,
                          }),
                        })
                        setRenameName('')
                        void openDetail(detail.id)
                      },
                    })
                  }}
                >
                  <input
                    className="input input-bordered input-sm w-36"
                    placeholder={t('guilds.newName')}
                    value={renameName}
                    onChange={(e) => setRenameName(e.target.value)}
                  />
                  <button type="submit" className="btn btn-sm">
                    {t('guilds.rename')}
                  </button>
                </form>
              </div>
            )}

            <Tabs items={detailTabs} />
          </div>
        )}
      </Drawer>

      <Drawer open={!!arenaDetail} width={560} title={t('guilds.arena')} onClose={() => setArenaDetail(null)}>
        <DataTable
          rowKey="guid"
          dataSource={arenaDetail?.members ?? []}
          columns={[
            { key: 'name', title: t('characters.name'), dataIndex: 'name' },
            { key: 'personal_rating', title: t('guilds.rating'), dataIndex: 'personal_rating', width: 100 },
            { key: 'season_wins', title: t('common.seasonWinsShort'), dataIndex: 'season_wins', width: 60 },
            { key: 'week_wins', title: t('common.weekWinsShort'), dataIndex: 'week_wins', width: 60 },
          ]}
        />
      </Drawer>

      <Drawer open={!!groupDetail} width={560} title={t('guilds.groups')} onClose={() => setGroupDetail(null)}>
        <DataTable
          rowKey="guid"
          dataSource={groupDetail?.members ?? []}
          columns={[
            { key: 'name', title: t('characters.name'), dataIndex: 'name' },
            { key: 'subgroup', title: t('common.subgroup'), dataIndex: 'subgroup', width: 90 },
            { key: 'roles', title: t('common.roles'), dataIndex: 'roles', width: 70 },
            {
              key: 'online',
              title: t('characters.online'),
              dataIndex: 'online',
              width: 80,
              render: (v) => (v ? t('common.yes') : t('common.no')),
            },
          ]}
        />
      </Drawer>

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
            if (mainTab === 'guilds') void load()
            if (mainTab === 'arena') void loadArena()
          } catch (err) {
            toast.error(errorMessage(err, t))
          }
        }}
      />
    </div>
  )
}
