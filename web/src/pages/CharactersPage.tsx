import {
  Alert,
  Button,
  Descriptions,
  Divider,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, errorMessage, hasMinRole } from '../api/client'
import { ConfirmDanger } from '../components/ConfirmDanger'
import { ItemSelect } from '../components/ItemSelect'
import { TeleSelect } from '../components/PlaceSelect'
import { RowActions, type RowActionItem } from '../components/RowActions'
import { classLabel, genderLabel } from '../utils/wowLabels'

type Character = {
  guid: number
  account_id: number
  account: string
  name: string
  race: number
  class: number
  class_name?: string
  gender: number
  level: number
  online: number
  map: number
  map_name?: string
  zone: number
  zone_name?: string
  money: number
  logout_time?: string
  xp?: number
  totaltime?: number
  position_x?: number
  position_y?: number
  position_z?: number
  orientation?: number
}

type InvItem = {
  bag: number
  slot: number
  item_guid: number
  item_entry: number
  count: number
  durability: number
  name: string
  slot_name?: string
}

type Inventory = {
  character: string
  guid: number
  online: number
  money: number
  equipment: InvItem[]
  bag_slots: InvItem[]
  backpack: InvItem[]
  other: InvItem[]
  note?: string
}

type ListResp = {
  items: Character[]
  total: number
  limit: number
  offset: number
}

type DeletedCharacter = {
  guid: number
  name: string
  account_id: number
  account: string
  delete_date?: string
}

type CharacterExtras = {
  character: string
  guid: number
  online: number
  reputation: { faction: number; standing: number; flags: number }[]
  achievements: { achievement: number; date?: string }[]
  pets: {
    id: number
    entry: number
    level: number
    slot: number
    name: string
    curhealth: number
    curmana: number
  }[]
}

function moneyStr(copper: number) {
  const g = Math.floor(copper / 10000)
  const s = Math.floor((copper % 10000) / 100)
  const c = copper % 100
  return `${g}g ${s}s ${c}c`
}

export function CharactersPage() {
  const { t, i18n } = useTranslation()
  const [q, setQ] = useState('')
  const [account, setAccount] = useState('')
  const [onlineOnly, setOnlineOnly] = useState(false)
  const [data, setData] = useState<ListResp | null>(null)
  const [loading, setLoading] = useState(false)
  const [detail, setDetail] = useState<Character | null>(null)
  const [inventory, setInventory] = useState<Inventory | null>(null)
  const [invLoading, setInvLoading] = useState(false)
  const [confirm, setConfirm] = useState<{
    title: string
    description: string
    run: () => Promise<void>
  } | null>(null)
  const [levelTarget, setLevelTarget] = useState<Character | null>(null)
  const [teleTarget, setTeleTarget] = useState<Character | null>(null)
  const [changeAccountTarget, setChangeAccountTarget] = useState<Character | null>(null)
  const [setNameTarget, setSetNameTarget] = useState<Character | null>(null)
  const [deletedQ, setDeletedQ] = useState('')
  const [deletedItems, setDeletedItems] = useState<DeletedCharacter[]>([])
  const [deletedLoading, setDeletedLoading] = useState(false)
  const [extras, setExtras] = useState<CharacterExtras | null>(null)
  const [extrasLoading, setExtrasLoading] = useState(false)
  const [titlesResult, setTitlesResult] = useState<string | null>(null)

  const load = useCallback(
    async (offset = 0) => {
      setLoading(true)
      try {
        const params = new URLSearchParams({ limit: '50', offset: String(offset) })
        if (q.trim()) params.set('q', q.trim())
        if (account.trim()) params.set('account', account.trim())
        if (onlineOnly) params.set('online', '1')
        const resp = await api<ListResp>(`/api/v1/characters?${params}`)
        setData(resp)
      } catch (err) {
        message.error(errorMessage(err, t))
      } finally {
        setLoading(false)
      }
    },
    [q, account, onlineOnly, t],
  )

  useEffect(() => {
    void load(0)
  }, [load, i18n.language])

  const loadDeleted = useCallback(async () => {
    setDeletedLoading(true)
    try {
      const params = new URLSearchParams()
      if (deletedQ.trim()) params.set('q', deletedQ.trim())
      const resp = await api<{ items: DeletedCharacter[] }>(`/api/v1/characters-deleted?${params}`)
      setDeletedItems(resp.items)
    } catch (err) {
      message.error(errorMessage(err, t))
    } finally {
      setDeletedLoading(false)
    }
  }, [deletedQ, t])

  useEffect(() => {
    void loadDeleted()
  }, [loadDeleted])

  const loadInventory = async (name: string) => {
    setInvLoading(true)
    try {
      setInventory(await api<Inventory>(`/api/v1/characters/${encodeURIComponent(name)}/inventory`))
    } catch (err) {
      message.error(errorMessage(err, t))
      setInventory(null)
    } finally {
      setInvLoading(false)
    }
  }

  const loadExtras = async (name: string) => {
    setExtrasLoading(true)
    try {
      setExtras(await api<CharacterExtras>(`/api/v1/characters/${encodeURIComponent(name)}/extras`))
    } catch (err) {
      message.error(errorMessage(err, t))
      setExtras(null)
    } finally {
      setExtrasLoading(false)
    }
  }

  const openDetail = async (name: string) => {
    try {
      const item = await api<Character>(`/api/v1/characters/${encodeURIComponent(name)}`)
      setDetail(item)
      setTitlesResult(null)
      void loadInventory(name)
      void loadExtras(name)
    } catch (err) {
      message.error(errorMessage(err, t))
    }
  }

  const itemColumns = [
    {
      title: t('characters.slot'),
      key: 'slot',
      width: 100,
      render: (_: unknown, row: InvItem) => row.slot_name || `${row.bag}/${row.slot}`,
    },
    { title: t('characters.itemEntry'), dataIndex: 'item_entry', width: 90 },
    { title: t('characters.itemName'), dataIndex: 'name', ellipsis: true },
    { title: t('mail.count'), dataIndex: 'count', width: 70 },
  ]

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }} wrap>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {t('pages.characters.title')}
        </Typography.Title>
        <Space wrap>
          <Input.Search
            allowClear
            placeholder={t('characters.searchName')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onSearch={() => void load(0)}
            style={{ width: 180 }}
          />
          <Input
            allowClear
            placeholder={t('characters.searchAccount')}
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            onPressEnter={() => void load(0)}
            style={{ width: 160 }}
          />
          <Space>
            <span>{t('characters.onlineOnly')}</span>
            <Switch checked={onlineOnly} onChange={setOnlineOnly} />
          </Space>
          <Button onClick={() => void load(data?.offset ?? 0)}>{t('common.refresh')}</Button>
        </Space>
      </Space>

      <Table
        loading={loading}
        rowKey="guid"
        dataSource={data?.items ?? []}
        pagination={{
          current: Math.floor((data?.offset ?? 0) / (data?.limit ?? 50)) + 1,
          pageSize: data?.limit ?? 50,
          total: data?.total ?? 0,
          onChange: (page, pageSize) => void load((page - 1) * pageSize),
        }}
        columns={[
          { title: t('characters.name'), dataIndex: 'name' },
          { title: t('characters.account'), dataIndex: 'account' },
          {
            title: t('common.class'),
            dataIndex: 'class',
            width: 110,
            render: (_: number, r: Character) => classLabel(r.class, i18n.language, r.class_name),
          },
          {
            title: t('common.gender'),
            dataIndex: 'gender',
            width: 70,
            render: (v: number) => genderLabel(v, i18n.language),
          },
          { title: t('characters.level'), dataIndex: 'level', width: 80 },
          {
            title: t('characters.online'),
            dataIndex: 'online',
            width: 90,
            render: (v: number) => (v ? <Tag color="success">{t('common.yes')}</Tag> : t('common.no')),
          },
          { title: t('characters.map'), dataIndex: 'map', width: 140, render: (_: number, r: Character) => r.map_name ? `${r.map_name} (#${r.map})` : r.map },
          { title: t('characters.zone'), dataIndex: 'zone', width: 140, render: (_: number, r: Character) => r.zone_name ? `${r.zone_name} (#${r.zone})` : r.zone },
          {
            title: t('characters.money'),
            dataIndex: 'money',
            render: (v: number) => moneyStr(v),
          },
          {
            title: t('common.actions'),
            width: 160,
            render: (_, row) => {
              const items: RowActionItem[] = []
              if (hasMinRole('gm')) {
                items.push(
                  {
                    key: 'kick',
                    label: t('characters.kick'),
                    hint: t('characters.kickHint'),
                    danger: true,
                    disabled: !row.online,
                    group: t('characters.groupOps'),
                    onClick: () =>
                      setConfirm({
                        title: t('characters.kick'),
                        description: t('characters.kickConfirm', { name: row.name }),
                        run: async () => {
                          await api(`/api/v1/characters/${encodeURIComponent(row.name)}/kick`, {
                            method: 'POST',
                            body: JSON.stringify({ confirm: true }),
                          })
                        },
                      }),
                  },
                  {
                    key: 'unstuck',
                    label: t('characters.unstuck'),
                    hint: t('characters.unstuckHint'),
                    group: t('characters.groupOps'),
                    onClick: () =>
                      setConfirm({
                        title: t('characters.unstuck'),
                        description: t('characters.unstuckConfirm', { name: row.name }),
                        run: async () => {
                          await api(`/api/v1/characters/${encodeURIComponent(row.name)}/teleport`, {
                            method: 'POST',
                            body: JSON.stringify({ action: 'unstuck' }),
                          })
                        },
                      }),
                  },
                  {
                    key: 'tele',
                    label: t('characters.tele'),
                    hint: t('characters.teleHint'),
                    group: t('characters.groupOps'),
                    onClick: () => setTeleTarget(row),
                  },
                  {
                    key: 'level',
                    label: t('characters.setLevel'),
                    hint: t('characters.setLevelHint'),
                    group: t('characters.groupOps'),
                    onClick: () => setLevelTarget(row),
                  },
                  {
                    key: 'faction',
                    label: t('characters.changeFaction'),
                    hint: t('characters.changeFactionHint'),
                    group: t('characters.groupLooks'),
                    onClick: () =>
                      setConfirm({
                        title: t('characters.changeFaction'),
                        description: t('characters.changeFactionConfirm', { name: row.name }),
                        run: async () => {
                          await api(`/api/v1/characters/${encodeURIComponent(row.name)}/changefaction`, {
                            method: 'POST',
                            body: JSON.stringify({ confirm: true }),
                          })
                        },
                      }),
                  },
                  {
                    key: 'race',
                    label: t('characters.changeRace'),
                    hint: t('characters.changeRaceHint'),
                    group: t('characters.groupLooks'),
                    onClick: () =>
                      setConfirm({
                        title: t('characters.changeRace'),
                        description: t('characters.changeRaceConfirm', { name: row.name }),
                        run: async () => {
                          await api(`/api/v1/characters/${encodeURIComponent(row.name)}/changerace`, {
                            method: 'POST',
                            body: JSON.stringify({ confirm: true }),
                          })
                        },
                      }),
                  },
                  {
                    key: 'rename',
                    label: t('characters.rename'),
                    hint: t('characters.renameHint'),
                    group: t('characters.groupLooks'),
                    onClick: () =>
                      setConfirm({
                        title: t('characters.rename'),
                        description: t('characters.renameConfirm', { name: row.name }),
                        run: async () => {
                          await api(`/api/v1/characters/${encodeURIComponent(row.name)}/rename`, {
                            method: 'POST',
                            body: JSON.stringify({ confirm: true }),
                          })
                        },
                      }),
                  },
                  {
                    key: 'setName',
                    label: t('characters.setName'),
                    hint: t('characters.setNameHint'),
                    disabled: !!row.online,
                    group: t('characters.groupLooks'),
                    onClick: () => setSetNameTarget(row),
                  },
                  {
                    key: 'customize',
                    label: t('characters.customize'),
                    hint: t('characters.customizeHint'),
                    group: t('characters.groupLooks'),
                    onClick: () =>
                      setConfirm({
                        title: t('characters.customize'),
                        description: t('characters.customizeConfirm', { name: row.name }),
                        run: async () => {
                          await api(`/api/v1/characters/${encodeURIComponent(row.name)}/customize`, {
                            method: 'POST',
                            body: JSON.stringify({ confirm: true }),
                          })
                        },
                      }),
                  },
                )
              }
              if (hasMinRole('superadmin')) {
                items.push({
                  key: 'changeAccount',
                  label: t('characters.changeAccount'),
                  hint: t('characters.changeAccountHint'),
                  danger: true,
                  onClick: () => setChangeAccountTarget(row),
                })
              }
              return (
                <RowActions
                  primary={
                    <Button size="small" onClick={() => void openDetail(row.name)}>
                      {t('characters.detail')}
                    </Button>
                  }
                  primaryHint={t('characters.detailHint')}
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
        width={720}
        title={detail?.name}
        onClose={() => {
          setDetail(null)
          setInventory(null)
          setExtras(null)
          setTitlesResult(null)
        }}
      >
        {detail && (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Descriptions column={2} bordered size="small">
              <Descriptions.Item label="GUID">{detail.guid}</Descriptions.Item>
              <Descriptions.Item label={t('characters.account')}>{detail.account}</Descriptions.Item>
              <Descriptions.Item label={t('characters.level')}>{detail.level}</Descriptions.Item>
              <Descriptions.Item label={t('common.class')}>
                {classLabel(detail.class, i18n.language, detail.class_name)}
                {detail.class != null ? ` (#${detail.class})` : ''}
              </Descriptions.Item>
              <Descriptions.Item label={t('common.gender')}>
                {genderLabel(detail.gender, i18n.language)}
              </Descriptions.Item>
              <Descriptions.Item label={t('characters.money')}>
                {moneyStr(inventory?.money ?? detail.money)}
              </Descriptions.Item>
              <Descriptions.Item label={t('characters.map')}>
                {detail.map_name ? `${detail.map_name} (#${detail.map})` : detail.map}
              </Descriptions.Item>
              <Descriptions.Item label={t('characters.zone')}>
                {detail.zone_name ? `${detail.zone_name} (#${detail.zone})` : detail.zone}
              </Descriptions.Item>
              <Descriptions.Item label={t('characters.position')} span={2}>
                {detail.position_x?.toFixed(1)}, {detail.position_y?.toFixed(1)}, {detail.position_z?.toFixed(1)}
              </Descriptions.Item>
              <Descriptions.Item label={t('characters.online')}>
                {detail.online ? t('common.yes') : t('common.no')}
              </Descriptions.Item>
            </Descriptions>

            <Space wrap>
              <Button
                size="small"
                loading={invLoading}
                onClick={() => {
                  void loadInventory(detail.name)
                  void loadExtras(detail.name)
                }}
              >
                {t('characters.refreshInv')}
              </Button>
              <Button
                size="small"
                onClick={async () => {
                  try {
                    const data = await api<{ result: string }>(
                      `/api/v1/characters/${encodeURIComponent(detail.name)}/titles`,
                    )
                    setTitlesResult(data.result || JSON.stringify(data))
                    message.success(t('common.ok'))
                  } catch (err) {
                    message.error(errorMessage(err, t))
                  }
                }}
              >
                {t('characters.loadTitles')}
              </Button>
            </Space>
            {titlesResult && (
              <Alert type="info" showIcon message={t('characters.titles')} description={<pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{titlesResult}</pre>} />
            )}

            {hasMinRole('gm') && (
              <>
                <Divider>{t('characters.sendMoney')}</Divider>
                <Alert type="info" showIcon message={t('characters.moneyHint')} style={{ marginBottom: 8 }} />
                <Form
                  layout="inline"
                  onFinish={(values: { money: string }) => {
                    setConfirm({
                      title: t('characters.sendMoney'),
                      description: t('characters.moneyConfirm', { name: detail.name, money: values.money }),
                      run: async () => {
                        await api(`/api/v1/characters/${encodeURIComponent(detail.name)}/money`, {
                          method: 'POST',
                          body: JSON.stringify({ money: values.money, confirm: true }),
                        })
                        void loadInventory(detail.name)
                      },
                    })
                  }}
                >
                  <Form.Item name="money" rules={[{ required: true }]} extra="1g2s3c">
                    <Input placeholder="1g2s3c" style={{ width: 160 }} />
                  </Form.Item>
                  <Button type="primary" htmlType="submit">
                    {t('characters.sendMoney')}
                  </Button>
                </Form>

                <Divider>{t('characters.sendItem')}</Divider>
                <Alert type="info" showIcon message={t('characters.itemHint')} style={{ marginBottom: 8 }} />
                <Form
                  layout="inline"
                  initialValues={{ count: 1 }}
                  onFinish={(values: { item_id: number; count: number }) => {
                    setConfirm({
                      title: t('characters.sendItem'),
                      description: t('characters.itemConfirm', {
                        name: detail.name,
                        item: values.item_id,
                        count: values.count,
                      }),
                      run: async () => {
                        await api(`/api/v1/characters/${encodeURIComponent(detail.name)}/items`, {
                          method: 'POST',
                          body: JSON.stringify({
                            action: 'send',
                            item_id: values.item_id,
                            count: values.count,
                            confirm: true,
                          }),
                        })
                        void loadInventory(detail.name)
                      },
                    })
                  }}
                >
                  <Form.Item name="item_id" rules={[{ required: true }]}>
                    <ItemSelect style={{ width: 280 }} />
                  </Form.Item>
                  <Form.Item name="count" rules={[{ required: true }]}>
                    <InputNumber min={1} max={1000} style={{ width: 100 }} />
                  </Form.Item>
                  <Button type="primary" htmlType="submit">
                    {t('characters.sendItem')}
                  </Button>
                </Form>
              </>
            )}

            <Divider>{t('characters.equipment')}</Divider>
            <Tabs
              items={[
                {
                  key: 'eq',
                  label: t('characters.equipment'),
                  children: (
                    <Table
                      size="small"
                      loading={invLoading}
                      rowKey={(r) => `${r.bag}-${r.slot}-${r.item_guid}`}
                      dataSource={inventory?.equipment ?? []}
                      pagination={false}
                      columns={itemColumns}
                    />
                  ),
                },
                {
                  key: 'bp',
                  label: t('characters.backpack'),
                  children: (
                    <Table
                      size="small"
                      loading={invLoading}
                      rowKey={(r) => `${r.bag}-${r.slot}-${r.item_guid}`}
                      dataSource={inventory?.backpack ?? []}
                      pagination={{ pageSize: 10 }}
                      columns={itemColumns}
                    />
                  ),
                },
                {
                  key: 'bags',
                  label: t('characters.bagSlots'),
                  children: (
                    <Table
                      size="small"
                      loading={invLoading}
                      rowKey={(r) => `${r.bag}-${r.slot}-${r.item_guid}`}
                      dataSource={[...(inventory?.bag_slots ?? []), ...(inventory?.other ?? [])]}
                      pagination={{ pageSize: 10 }}
                      columns={itemColumns}
                    />
                  ),
                },
                {
                  key: 'rep',
                  label: t('characters.reputation'),
                  children: (
                    <Table
                      size="small"
                      loading={extrasLoading}
                      rowKey={(r) => r.faction}
                      dataSource={extras?.reputation ?? []}
                      pagination={{ pageSize: 10 }}
                      columns={[
                        { title: t('characters.factionId'), dataIndex: 'faction', width: 100 },
                        { title: t('characters.standing'), dataIndex: 'standing', width: 100 },
                        { title: t('common.flags'), dataIndex: 'flags', width: 80 },
                      ]}
                    />
                  ),
                },
                {
                  key: 'ach',
                  label: t('characters.achievements'),
                  children: (
                    <Table
                      size="small"
                      loading={extrasLoading}
                      rowKey={(r) => r.achievement}
                      dataSource={extras?.achievements ?? []}
                      pagination={{ pageSize: 10 }}
                      columns={[
                        { title: 'ID', dataIndex: 'achievement', width: 100 },
                        { title: t('audit.at'), dataIndex: 'date' },
                      ]}
                    />
                  ),
                },
                {
                  key: 'pets',
                  label: t('characters.pets'),
                  children: (
                    <Table
                      size="small"
                      loading={extrasLoading}
                      rowKey="id"
                      dataSource={extras?.pets ?? []}
                      pagination={{ pageSize: 10 }}
                      columns={[
                        { title: 'ID', dataIndex: 'id', width: 70 },
                        { title: t('characters.name'), dataIndex: 'name' },
                        { title: t('common.entry'), dataIndex: 'entry', width: 80 },
                        { title: t('characters.level'), dataIndex: 'level', width: 70 },
                        { title: t('guilds.rank'), dataIndex: 'slot', width: 70 },
                        {
                          title: t('common.actions'),
                          render: (_, pet) =>
                            hasMinRole('gm') ? (
                              <Button
                                size="small"
                                danger
                                disabled={!!detail.online}
                                onClick={() =>
                                  setConfirm({
                                    title: t('characters.deletePet'),
                                    description: t('characters.deletePetConfirm', {
                                      name: detail.name,
                                      id: pet.id,
                                    }),
                                    run: async () => {
                                      await api(
                                        `/api/v1/characters/${encodeURIComponent(detail.name)}/pets/${pet.id}`,
                                        {
                                          method: 'DELETE',
                                          body: JSON.stringify({ confirm: true }),
                                        },
                                      )
                                      void loadExtras(detail.name)
                                    },
                                  })
                                }
                              >
                                {t('characters.deletePet')}
                              </Button>
                            ) : null,
                        },
                      ]}
                    />
                  ),
                },
              ]}
            />
          </Space>
        )}
      </Drawer>

      <Divider />
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 12 }} wrap>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {t('characters.deleted')}
        </Typography.Title>
        <Space wrap>
          <Input.Search
            allowClear
            placeholder={t('characters.searchName')}
            value={deletedQ}
            onChange={(e) => setDeletedQ(e.target.value)}
            onSearch={() => void loadDeleted()}
            style={{ width: 180 }}
          />
          <Button onClick={() => void loadDeleted()}>{t('common.refresh')}</Button>
          {hasMinRole('superadmin') && (
            <Tooltip title={t('characters.purgeHint')}>
              <Button
                danger
                onClick={() =>
                  setConfirm({
                    title: t('characters.purge'),
                    description: t('characters.purgeConfirm'),
                    run: async () => {
                      await api('/api/v1/characters-deleted', {
                        method: 'POST',
                        body: JSON.stringify({ action: 'purge', keep_days: 30, confirm: true }),
                      })
                      void loadDeleted()
                    },
                  })
                }
              >
                {t('characters.purge')}
              </Button>
            </Tooltip>
          )}
        </Space>
      </Space>
      <Table
        loading={deletedLoading}
        rowKey="guid"
        dataSource={deletedItems}
        pagination={{ pageSize: 20 }}
        columns={[
          { title: 'GUID', dataIndex: 'guid', width: 90 },
          { title: t('characters.name'), dataIndex: 'name' },
          { title: t('characters.account'), dataIndex: 'account' },
          { title: t('audit.at'), dataIndex: 'delete_date' },
          {
            title: t('common.actions'),
            render: (_, row) =>
              hasMinRole('superadmin') ? (
                <Space>
                  <Tooltip title={t('characters.restoreHint')}>
                    <Button
                      size="small"
                      onClick={() =>
                        setConfirm({
                          title: t('characters.restore'),
                          description: t('characters.restoreConfirm', { guid: row.guid }),
                          run: async () => {
                            await api('/api/v1/characters-deleted', {
                              method: 'POST',
                              body: JSON.stringify({ action: 'restore', guid: row.guid, confirm: true }),
                            })
                            void loadDeleted()
                            void load(data?.offset ?? 0)
                          },
                        })
                      }
                    >
                      {t('characters.restore')}
                    </Button>
                  </Tooltip>
                  <Tooltip title={t('characters.eraseHint')}>
                    <Button
                      size="small"
                      danger
                      onClick={() =>
                        setConfirm({
                          title: t('characters.erase'),
                          description: t('characters.eraseConfirm', { guid: row.guid }),
                          run: async () => {
                            await api('/api/v1/characters-deleted', {
                              method: 'POST',
                              body: JSON.stringify({ action: 'delete', guid: row.guid, confirm: true }),
                            })
                            void loadDeleted()
                          },
                        })
                      }
                    >
                      {t('characters.erase')}
                    </Button>
                  </Tooltip>
                </Space>
              ) : null,
          },
        ]}
      />

      <LevelModal
        character={levelTarget}
        onClose={() => setLevelTarget(null)}
        onSubmit={(level) => {
          if (!levelTarget) return
          setConfirm({
            title: t('characters.setLevel'),
            description: t('characters.levelConfirm', { name: levelTarget.name, level }),
            run: async () => {
              await api(`/api/v1/characters/${encodeURIComponent(levelTarget.name)}/level`, {
                method: 'POST',
                body: JSON.stringify({ level, confirm: true }),
              })
              setLevelTarget(null)
            },
          })
        }}
      />

      <TeleModal
        character={teleTarget}
        onClose={() => setTeleTarget(null)}
        onSubmit={(location) => {
          if (!teleTarget) return
          setConfirm({
            title: t('characters.tele'),
            description: t('characters.teleConfirm', { name: teleTarget.name, location }),
            run: async () => {
              await api(`/api/v1/characters/${encodeURIComponent(teleTarget.name)}/teleport`, {
                method: 'POST',
                body: JSON.stringify({ action: 'tele', location, confirm: true }),
              })
              setTeleTarget(null)
            },
          })
        }}
      />

      <ChangeAccountModal
        character={changeAccountTarget}
        onClose={() => setChangeAccountTarget(null)}
        onSubmit={(account) => {
          if (!changeAccountTarget) return
          setConfirm({
            title: t('characters.changeAccount'),
            description: t('characters.changeAccountConfirm', {
              name: changeAccountTarget.name,
              account,
            }),
            run: async () => {
              await api(`/api/v1/characters/${encodeURIComponent(changeAccountTarget.name)}/changeaccount`, {
                method: 'POST',
                body: JSON.stringify({ account, confirm: true }),
              })
              setChangeAccountTarget(null)
            },
          })
        }}
      />

      <SetNameModal
        character={setNameTarget}
        onClose={() => setSetNameTarget(null)}
        onSubmit={(newName) => {
          if (!setNameTarget) return
          const oldName = setNameTarget.name
          setConfirm({
            title: t('characters.setName'),
            description: t('characters.setNameConfirm', { old: oldName, new: newName }),
            run: async () => {
              await api(`/api/v1/characters/${encodeURIComponent(oldName)}/setname`, {
                method: 'POST',
                body: JSON.stringify({ new_name: newName, confirm: true }),
              })
              setSetNameTarget(null)
              if (detail?.name === oldName) {
                setDetail(null)
              }
            },
          })
        }}
      />

      <ConfirmDanger
        open={!!confirm}
        title={confirm?.title}
        description={confirm?.description}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          if (!confirm) return
          try {
            await confirm.run()
            message.success(t('common.ok'))
            setConfirm(null)
            void load(data?.offset ?? 0)
          } catch (err) {
            message.error(errorMessage(err, t))
          }
        }}
      />
    </div>
  )
}

function LevelModal({
  character,
  onClose,
  onSubmit,
}: {
  character: Character | null
  onClose: () => void
  onSubmit: (level: number) => void
}) {
  const { t } = useTranslation()
  const [form] = Form.useForm()
  return (
    <Modal
      open={!!character}
      title={t('characters.setLevel')}
      onCancel={onClose}
      onOk={() => form.submit()}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ level: character?.level ?? 1 }}
        onFinish={(values: { level: number }) => onSubmit(values.level)}
      >
        <Form.Item name="level" label={t('characters.level')} rules={[{ required: true }]}>
          <InputNumber min={1} max={80} style={{ width: '100%' }} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

function ChangeAccountModal({
  character,
  onClose,
  onSubmit,
}: {
  character: Character | null
  onClose: () => void
  onSubmit: (account: string) => void
}) {
  const { t } = useTranslation()
  const [form] = Form.useForm()
  return (
    <Modal
      open={!!character}
      title={t('characters.changeAccount')}
      onCancel={onClose}
      onOk={() => form.submit()}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={(values: { account: string }) => onSubmit(values.account.trim())}
      >
        <Form.Item label={t('characters.name')}>
          <Input value={character?.name} disabled />
        </Form.Item>
        <Form.Item name="account" label={t('characters.targetAccount')} rules={[{ required: true }]}>
          <Input />
        </Form.Item>
      </Form>
    </Modal>
  )
}

function SetNameModal({
  character,
  onClose,
  onSubmit,
}: {
  character: Character | null
  onClose: () => void
  onSubmit: (newName: string) => void
}) {
  const { t } = useTranslation()
  const [form] = Form.useForm()
  useEffect(() => {
    if (character) form.resetFields()
  }, [character, form])
  return (
    <Modal
      open={!!character}
      title={t('characters.setName')}
      onCancel={onClose}
      onOk={() => form.submit()}
      destroyOnHidden
    >
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t('characters.setNameHint')} />
      <Form
        form={form}
        layout="vertical"
        onFinish={(values: { new_name: string }) => onSubmit(values.new_name.trim())}
      >
        <Form.Item label={t('characters.name')}>
          <Input value={character?.name} disabled />
        </Form.Item>
        <Form.Item name="new_name" label={t('characters.newName')} rules={[{ required: true }]}>
          <Input maxLength={16} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

function TeleModal({
  character,
  onClose,
  onSubmit,
}: {
  character: Character | null
  onClose: () => void
  onSubmit: (location: string) => void
}) {
  const { t } = useTranslation()
  const [form] = Form.useForm()

  useEffect(() => {
    if (character) form.resetFields()
  }, [character, form])

  return (
    <Modal
      open={!!character}
      title={t('characters.tele')}
      onCancel={onClose}
      onOk={() => form.submit()}
      destroyOnHidden
    >
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t('characters.teleHint')} />
      <Form form={form} layout="vertical" onFinish={(values: { location: string }) => onSubmit(values.location)}>
        <Form.Item label={t('characters.name')}>
          <Input value={character?.name} disabled />
        </Form.Item>
        <Form.Item name="location" label={t('characters.teleLocation')} rules={[{ required: true }]}>
          <TeleSelect />
        </Form.Item>
      </Form>
    </Modal>
  )
}
