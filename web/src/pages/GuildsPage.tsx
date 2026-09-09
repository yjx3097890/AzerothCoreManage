import { Button, Drawer, Form, Input, InputNumber, Select, Space, Table, Tabs, Typography, message } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, errorMessage, hasMinRole } from '../api/client'
import { ConfirmDanger } from '../components/ConfirmDanger'

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
  const [createForm] = Form.useForm()
  const [renameForm] = Form.useForm()

  const [arenaQ, setArenaQ] = useState('')
  const [arenaItems, setArenaItems] = useState<ArenaTeam[]>([])
  const [arenaSeason, setArenaSeason] = useState<{ season_id?: number; season_state?: number }>({})
  const [arenaLoading, setArenaLoading] = useState(false)
  const [arenaDetail, setArenaDetail] = useState<{ id: number; members: ArenaMember[] } | null>(null)

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
      message.error(errorMessage(err, t))
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
      message.error(errorMessage(err, t))
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
      message.error(errorMessage(err, t))
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
        message.error(errorMessage(err, t))
      } finally {
        setBankLoading(false)
      }
    } catch (err) {
      message.error(errorMessage(err, t))
    }
  }

  const openArena = async (id: number) => {
    try {
      setArenaDetail(await api<{ id: number; members: ArenaMember[] }>(`/api/v1/arena/teams/${id}`))
    } catch (err) {
      message.error(errorMessage(err, t))
    }
  }

  const openGroup = async (id: number) => {
    try {
      setGroupDetail(await api<{ guid: number; members: GroupMember[] }>(`/api/v1/groups/${id}`))
    } catch (err) {
      message.error(errorMessage(err, t))
    }
  }

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }} wrap>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {t('pages.guilds.title')}
        </Typography.Title>
      </Space>

      <Tabs
        activeKey={mainTab}
        onChange={setMainTab}
        items={[
          {
            key: 'guilds',
            label: t('guilds.tabGuilds'),
            children: (
              <>
                <Space style={{ marginBottom: 16 }} wrap>
                  <Input.Search
                    allowClear
                    placeholder={t('guilds.search')}
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onSearch={() => void load()}
                  />
                  <Button onClick={() => void load()}>{t('common.refresh')}</Button>
                </Space>

                {hasMinRole('gm') && (
                  <Form
                    form={createForm}
                    layout="inline"
                    style={{ marginBottom: 16 }}
                    onFinish={(values: { leader: string; guild: string }) => {
                      setPending({
                        title: t('guilds.create'),
                        description: t('guilds.createConfirm', {
                          leader: values.leader,
                          guild: values.guild,
                        }),
                        run: async () => {
                          await api('/api/v1/guilds/action', {
                            method: 'POST',
                            body: JSON.stringify({
                              action: 'create',
                              leader: values.leader,
                              guild: values.guild,
                              confirm: true,
                            }),
                          })
                          createForm.resetFields()
                        },
                      })
                    }}
                  >
                    <Form.Item name="leader" label={t('guilds.leader')} rules={[{ required: true }]}>
                      <Input style={{ width: 140 }} />
                    </Form.Item>
                    <Form.Item name="guild" label={t('guilds.name')} rules={[{ required: true }]}>
                      <Input style={{ width: 160 }} />
                    </Form.Item>
                    <Button type="primary" htmlType="submit">
                      {t('guilds.create')}
                    </Button>
                  </Form>
                )}

                <Table
                  loading={loading}
                  rowKey="id"
                  dataSource={items}
                  columns={[
                    { title: 'ID', dataIndex: 'id', width: 80 },
                    { title: t('guilds.name'), dataIndex: 'name' },
                    { title: t('guilds.leader'), dataIndex: 'leader_name' },
                    { title: t('guilds.bank'), dataIndex: 'bank_money' },
                    {
                      title: t('common.actions'),
                      render: (_, row) => (
                        <Button size="small" onClick={() => void openDetail(row.id)}>
                          {t('guilds.members')}
                        </Button>
                      ),
                    },
                  ]}
                />
              </>
            ),
          },
          {
            key: 'arena',
            label: t('guilds.arena'),
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                <Space wrap>
                  <Input.Search
                    allowClear
                    placeholder={t('guilds.arenaSearch')}
                    value={arenaQ}
                    onChange={(e) => setArenaQ(e.target.value)}
                    onSearch={() => void loadArena()}
                  />
                  <Button onClick={() => void loadArena()}>{t('common.refresh')}</Button>
                  <Typography.Text type="secondary">
                    {t('guilds.season')}: {arenaSeason.season_id ?? '-'} / {t('guilds.seasonState')}:{' '}
                    {arenaSeason.season_state ?? '-'}
                  </Typography.Text>
                </Space>

                {hasMinRole('superadmin') && (
                  <Form
                    layout="inline"
                    initialValues={{ action: 'start' }}
                    onFinish={(values: { action: string; id?: number; state?: number }) => {
                      setPending({
                        title: t('guilds.arenaSeason'),
                        description: t('guilds.arenaSeasonConfirm', {
                          action: values.action,
                          id: values.id ?? '',
                          state: values.state ?? '',
                        }),
                        run: async () => {
                          await api('/api/v1/arena/season', {
                            method: 'POST',
                            body: JSON.stringify({
                              action: values.action,
                              id: values.id,
                              state: values.state,
                              confirm: true,
                            }),
                          })
                          await loadArena()
                        },
                      })
                    }}
                  >
                    <Form.Item name="action" rules={[{ required: true }]}>
                      <Select
                        style={{ width: 140 }}
                        options={[
                          { value: 'start', label: t('common.start') },
                          { value: 'set_state', label: t('guilds.seasonSetState') },
                          { value: 'reward', label: t('guilds.seasonReward') },
                          { value: 'deleteteams', label: t('guilds.seasonDeleteTeams') },
                        ]}
                      />
                    </Form.Item>
                    <Form.Item noStyle shouldUpdate={(a, b) => a.action !== b.action}>
                      {({ getFieldValue }) =>
                        getFieldValue('action') === 'start' ? (
                          <Form.Item name="id" rules={[{ required: true }]}>
                            <InputNumber min={1} placeholder={t('guilds.seasonId')} />
                          </Form.Item>
                        ) : getFieldValue('action') === 'set_state' ? (
                          <Form.Item name="state" rules={[{ required: true }]}>
                            <Select
                              style={{ width: 100 }}
                              options={[
                                { value: 0, label: '0' },
                                { value: 1, label: '1' },
                              ]}
                            />
                          </Form.Item>
                        ) : null
                      }
                    </Form.Item>
                    <Button danger htmlType="submit">
                      {t('guilds.arenaSeason')}
                    </Button>
                  </Form>
                )}

                <Table
                  loading={arenaLoading}
                  rowKey="id"
                  dataSource={arenaItems}
                  columns={[
                    { title: 'ID', dataIndex: 'id', width: 70 },
                    { title: t('guilds.name'), dataIndex: 'name' },
                    { title: t('guilds.captain'), dataIndex: 'captain_name' },
                    { title: t('guilds.arenaType'), dataIndex: 'type', width: 70 },
                    { title: t('guilds.rating'), dataIndex: 'rating', width: 90 },
                    { title: t('guilds.rank'), dataIndex: 'rank', width: 70 },
                    {
                      title: t('common.actions'),
                      render: (_, row) => (
                        <Button size="small" onClick={() => void openArena(row.id)}>
                          {t('guilds.members')}
                        </Button>
                      ),
                    },
                  ]}
                />
              </Space>
            ),
          },
          {
            key: 'groups',
            label: t('guilds.groups'),
            children: (
              <>
                <Space style={{ marginBottom: 16 }}>
                  <Button onClick={() => void loadGroups()}>{t('common.refresh')}</Button>
                  <Typography.Text type="secondary">{t('guilds.groupsReadonly')}</Typography.Text>
                </Space>
                <Table
                  loading={groupsLoading}
                  rowKey="guid"
                  dataSource={groups}
                  columns={[
                    { title: 'GUID', dataIndex: 'guid', width: 90 },
                    { title: t('guilds.leader'), dataIndex: 'leader_name' },
                    { title: t('guilds.groupType'), dataIndex: 'group_type', width: 90 },
                    { title: t('guilds.members'), dataIndex: 'members', width: 90 },
                    {
                      title: t('common.actions'),
                      render: (_, row) => (
                        <Button size="small" onClick={() => void openGroup(row.guid)}>
                          {t('guilds.members')}
                        </Button>
                      ),
                    },
                  ]}
                />
              </>
            ),
          },
        ]}
      />

      <Drawer
        open={!!detail}
        width={640}
        title={detail?.name}
        onClose={() => {
          setDetail(null)
          setBank(null)
          renameForm.resetFields()
        }}
      >
        {detail && (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            {hasMinRole('gm') && (
              <Space wrap>
                <Button
                  danger
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
                </Button>
                <Form
                  form={renameForm}
                  layout="inline"
                  onFinish={(values: { new_name: string }) => {
                    setPending({
                      title: t('guilds.rename'),
                      description: t('guilds.renameConfirm', {
                        guild: detail.name,
                        newName: values.new_name,
                      }),
                      run: async () => {
                        await api('/api/v1/guilds/action', {
                          method: 'POST',
                          body: JSON.stringify({
                            action: 'rename',
                            guild: detail.name,
                            new_name: values.new_name,
                            confirm: true,
                          }),
                        })
                        renameForm.resetFields()
                        void openDetail(detail.id)
                      },
                    })
                  }}
                >
                  <Form.Item name="new_name" rules={[{ required: true }]}>
                    <Input placeholder={t('guilds.newName')} style={{ width: 140 }} />
                  </Form.Item>
                  <Button htmlType="submit">{t('guilds.rename')}</Button>
                </Form>
              </Space>
            )}

            <Tabs
              items={[
                {
                  key: 'members',
                  label: t('guilds.members'),
                  children: (
                    <Table
                      size="small"
                      rowKey="guid"
                      dataSource={detail.members ?? []}
                      pagination={false}
                      columns={[
                        { title: t('characters.name'), dataIndex: 'name' },
                        { title: t('guilds.rank'), dataIndex: 'rank_name' },
                        {
                          title: t('common.actions'),
                          render: (_, m) =>
                            hasMinRole('gm') ? (
                              <Button
                                size="small"
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
                              </Button>
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
                    <Table
                      size="small"
                      loading={bankLoading}
                      rowKey={(r) => `${r.tab}-${r.slot}-${r.item_guid}`}
                      dataSource={bank?.items ?? []}
                      pagination={{ pageSize: 20 }}
                      columns={[
                        { title: t('guilds.tab'), dataIndex: 'tab', width: 70 },
                        { title: t('common.slot'), dataIndex: 'slot', width: 70 },
                        { title: t('characters.itemEntry'), dataIndex: 'item_entry', width: 90 },
                        { title: t('characters.itemName'), dataIndex: 'name', ellipsis: true },
                        { title: t('mail.count'), dataIndex: 'count', width: 70 },
                      ]}
                    />
                  ),
                },
              ]}
            />
          </Space>
        )}
      </Drawer>

      <Drawer open={!!arenaDetail} width={560} title={t('guilds.arena')} onClose={() => setArenaDetail(null)}>
        <Table
          size="small"
          rowKey="guid"
          dataSource={arenaDetail?.members ?? []}
          columns={[
            { title: t('characters.name'), dataIndex: 'name' },
            { title: t('guilds.rating'), dataIndex: 'personal_rating', width: 100 },
            { title: t('common.seasonWinsShort'), dataIndex: 'season_wins', width: 60 },
            { title: t('common.weekWinsShort'), dataIndex: 'week_wins', width: 60 },
          ]}
        />
      </Drawer>

      <Drawer open={!!groupDetail} width={560} title={t('guilds.groups')} onClose={() => setGroupDetail(null)}>
        <Table
          size="small"
          rowKey="guid"
          dataSource={groupDetail?.members ?? []}
          columns={[
            { title: t('characters.name'), dataIndex: 'name' },
            { title: t('common.subgroup'), dataIndex: 'subgroup', width: 90 },
            { title: t('common.roles'), dataIndex: 'roles', width: 70 },
            {
              title: t('characters.online'),
              dataIndex: 'online',
              width: 80,
              render: (v: number) => (v ? t('common.yes') : t('common.no')),
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
            message.success(t('common.ok'))
            setPending(null)
            if (mainTab === 'guilds') void load()
            if (mainTab === 'arena') void loadArena()
          } catch (err) {
            message.error(errorMessage(err, t))
          }
        }}
      />
    </div>
  )
}
