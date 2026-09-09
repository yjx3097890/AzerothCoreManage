import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { api, errorMessage, hasMinRole } from '../api/client'
import { ConfirmDanger } from '../components/ConfirmDanger'
import { ItemSelect } from '../components/ItemSelect'
import { TeleSelect } from '../components/PlaceSelect'
import { RowActions, type RowActionItem } from '../components/RowActions'
import { DataTable, Drawer, Modal, Tabs, toast, type Column, type TabItem } from '../ui'
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

type Reputation = { faction: number; standing: number; flags: number }
type Achievement = { achievement: number; date?: string }
type Pet = {
  id: number
  entry: number
  level: number
  slot: number
  name: string
  curhealth: number
  curmana: number
}

type CharacterExtras = {
  character: string
  guid: number
  online: number
  reputation: Reputation[]
  achievements: Achievement[]
  pets: Pet[]
}

function moneyStr(copper: number) {
  const g = Math.floor(copper / 10000)
  const s = Math.floor((copper % 10000) / 100)
  const c = copper % 100
  return `${g}g ${s}s ${c}c`
}

function Field({ label, children, span }: { label: ReactNode; children: ReactNode; span?: boolean }) {
  return (
    <div className={`bg-base-100 px-3 py-2 ${span ? 'sm:col-span-2' : ''}`}>
      <div className="text-xs text-base-content/60">{label}</div>
      <div className="text-sm break-all">{children}</div>
    </div>
  )
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
  const [moneyInput, setMoneyInput] = useState('')
  const [itemId, setItemId] = useState<number | null>(null)
  const [itemCount, setItemCount] = useState(1)

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
        toast.error(errorMessage(err, t))
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
      toast.error(errorMessage(err, t))
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
      toast.error(errorMessage(err, t))
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
      toast.error(errorMessage(err, t))
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
      toast.error(errorMessage(err, t))
    }
  }

  const itemColumns: Column<InvItem>[] = [
    {
      key: 'slot',
      title: t('characters.slot'),
      width: 100,
      render: (_v, row) => row.slot_name || `${row.bag}/${row.slot}`,
    },
    { key: 'item_entry', title: t('characters.itemEntry'), dataIndex: 'item_entry', width: 90 },
    { key: 'name', title: t('characters.itemName'), dataIndex: 'name' },
    { key: 'count', title: t('mail.count'), dataIndex: 'count', width: 70 },
  ]

  const limit = data?.limit ?? 50
  const offset = data?.offset ?? 0
  const total = data?.total ?? 0
  const currentPage = Math.floor(offset / limit) + 1
  const totalPages = Math.max(1, Math.ceil(total / limit) || 1)

  const columns: Column<Character>[] = [
    { key: 'name', title: t('characters.name'), dataIndex: 'name' },
    { key: 'account', title: t('characters.account'), dataIndex: 'account' },
    {
      key: 'class',
      title: t('common.class'),
      width: 110,
      render: (_v, r) => classLabel(r.class, i18n.language, r.class_name),
    },
    {
      key: 'gender',
      title: t('common.gender'),
      dataIndex: 'gender',
      width: 70,
      render: (v) => genderLabel(v as number, i18n.language),
    },
    { key: 'level', title: t('characters.level'), dataIndex: 'level', width: 80 },
    {
      key: 'online',
      title: t('characters.online'),
      dataIndex: 'online',
      width: 90,
      render: (v) => (v ? <span className="badge badge-success badge-sm">{t('common.yes')}</span> : t('common.no')),
    },
    {
      key: 'map',
      title: t('characters.map'),
      width: 140,
      render: (_v, r) => (r.map_name ? `${r.map_name} (#${r.map})` : r.map),
    },
    {
      key: 'zone',
      title: t('characters.zone'),
      width: 140,
      render: (_v, r) => (r.zone_name ? `${r.zone_name} (#${r.zone})` : r.zone),
    },
    {
      key: 'money',
      title: t('characters.money'),
      dataIndex: 'money',
      render: (v) => moneyStr(v as number),
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
              <button type="button" className="btn btn-xs" onClick={() => void openDetail(row.name)}>
                {t('characters.detail')}
              </button>
            }
            primaryHint={t('characters.detailHint')}
            moreHint={t('common.moreHint')}
            items={items}
          />
        )
      },
    },
  ]

  const deletedColumns: Column<DeletedCharacter>[] = [
    { key: 'guid', title: 'GUID', dataIndex: 'guid', width: 90 },
    { key: 'name', title: t('characters.name'), dataIndex: 'name' },
    { key: 'account', title: t('characters.account'), dataIndex: 'account' },
    { key: 'delete_date', title: t('audit.at'), dataIndex: 'delete_date' },
    {
      key: 'actions',
      title: t('common.actions'),
      render: (_v, row) =>
        hasMinRole('superadmin') ? (
          <div className="flex items-center gap-2">
            <span className="tooltip tooltip-left" data-tip={t('characters.restoreHint')}>
              <button
                type="button"
                className="btn btn-xs"
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
              </button>
            </span>
            <span className="tooltip tooltip-left" data-tip={t('characters.eraseHint')}>
              <button
                type="button"
                className="btn btn-xs btn-error"
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
              </button>
            </span>
          </div>
        ) : null,
    },
  ]

  const detailTabs: TabItem[] = detail
    ? [
        {
          key: 'eq',
          label: t('characters.equipment'),
          children: (
            <DataTable
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
            <DataTable
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
            <DataTable
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
            <DataTable
              loading={extrasLoading}
              rowKey={(r) => r.faction}
              dataSource={extras?.reputation ?? []}
              pagination={{ pageSize: 10 }}
              columns={[
                { key: 'faction', title: t('characters.factionId'), dataIndex: 'faction', width: 100 },
                { key: 'standing', title: t('characters.standing'), dataIndex: 'standing', width: 100 },
                { key: 'flags', title: t('common.flags'), dataIndex: 'flags', width: 80 },
              ]}
            />
          ),
        },
        {
          key: 'ach',
          label: t('characters.achievements'),
          children: (
            <DataTable
              loading={extrasLoading}
              rowKey={(r) => r.achievement}
              dataSource={extras?.achievements ?? []}
              pagination={{ pageSize: 10 }}
              columns={[
                { key: 'achievement', title: 'ID', dataIndex: 'achievement', width: 100 },
                { key: 'date', title: t('audit.at'), dataIndex: 'date' },
              ]}
            />
          ),
        },
        {
          key: 'pets',
          label: t('characters.pets'),
          children: (
            <DataTable
              loading={extrasLoading}
              rowKey="id"
              dataSource={extras?.pets ?? []}
              pagination={{ pageSize: 10 }}
              columns={[
                { key: 'id', title: 'ID', dataIndex: 'id', width: 70 },
                { key: 'name', title: t('characters.name'), dataIndex: 'name' },
                { key: 'entry', title: t('common.entry'), dataIndex: 'entry', width: 80 },
                { key: 'level', title: t('characters.level'), dataIndex: 'level', width: 70 },
                { key: 'slot', title: t('guilds.rank'), dataIndex: 'slot', width: 70 },
                {
                  key: 'actions',
                  title: t('common.actions'),
                  render: (_v, pet) =>
                    hasMinRole('gm') ? (
                      <button
                        type="button"
                        className="btn btn-xs btn-error"
                        disabled={!!detail.online}
                        onClick={() =>
                          setConfirm({
                            title: t('characters.deletePet'),
                            description: t('characters.deletePetConfirm', {
                              name: detail.name,
                              id: pet.id,
                            }),
                            run: async () => {
                              await api(`/api/v1/characters/${encodeURIComponent(detail.name)}/pets/${pet.id}`, {
                                method: 'DELETE',
                                body: JSON.stringify({ confirm: true }),
                              })
                              void loadExtras(detail.name)
                            },
                          })
                        }
                      >
                        {t('characters.deletePet')}
                      </button>
                    ) : null,
                },
              ]}
            />
          ),
        },
      ]
    : []

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-xl font-semibold m-0">{t('pages.characters.title')}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="input input-bordered input-sm w-44"
            placeholder={t('characters.searchName')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void load(0)
            }}
          />
          <input
            className="input input-bordered input-sm w-40"
            placeholder={t('characters.searchAccount')}
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void load(0)
            }}
          />
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <span>{t('characters.onlineOnly')}</span>
            <input
              type="checkbox"
              className="toggle toggle-sm"
              checked={onlineOnly}
              onChange={(e) => setOnlineOnly(e.target.checked)}
            />
          </label>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => void load(0)}>
            {t('common.search')}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => void load(data?.offset ?? 0)}>
            {t('common.refresh')}
          </button>
        </div>
      </div>

      <DataTable
        loading={loading}
        rowKey="guid"
        dataSource={data?.items ?? []}
        pagination={false}
        columns={columns}
      />
      {total > limit && (
        <div className="flex items-center justify-end gap-2 mt-3">
          <span className="text-sm text-base-content/60">
            {total} · {currentPage}/{totalPages}
          </span>
          <button
            type="button"
            className="btn btn-sm"
            disabled={currentPage <= 1}
            onClick={() => void load(Math.max(0, offset - limit))}
          >
            ‹
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={currentPage >= totalPages}
            onClick={() => void load(offset + limit)}
          >
            ›
          </button>
        </div>
      )}

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
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-base-300 border border-base-300 rounded-box overflow-hidden">
              <Field label="GUID">{detail.guid}</Field>
              <Field label={t('characters.account')}>{detail.account}</Field>
              <Field label={t('characters.level')}>{detail.level}</Field>
              <Field label={t('common.class')}>
                {classLabel(detail.class, i18n.language, detail.class_name)}
                {detail.class != null ? ` (#${detail.class})` : ''}
              </Field>
              <Field label={t('common.gender')}>{genderLabel(detail.gender, i18n.language)}</Field>
              <Field label={t('characters.money')}>{moneyStr(inventory?.money ?? detail.money)}</Field>
              <Field label={t('characters.map')}>
                {detail.map_name ? `${detail.map_name} (#${detail.map})` : detail.map}
              </Field>
              <Field label={t('characters.zone')}>
                {detail.zone_name ? `${detail.zone_name} (#${detail.zone})` : detail.zone}
              </Field>
              <Field label={t('characters.position')} span>
                {detail.position_x?.toFixed(1)}, {detail.position_y?.toFixed(1)}, {detail.position_z?.toFixed(1)}
              </Field>
              <Field label={t('characters.online')}>{detail.online ? t('common.yes') : t('common.no')}</Field>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-sm"
                disabled={invLoading}
                onClick={() => {
                  void loadInventory(detail.name)
                  void loadExtras(detail.name)
                }}
              >
                {invLoading && <span className="loading loading-spinner loading-xs" />}
                {t('characters.refreshInv')}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={async () => {
                  try {
                    const resp = await api<{ result: string }>(
                      `/api/v1/characters/${encodeURIComponent(detail.name)}/titles`,
                    )
                    setTitlesResult(resp.result || JSON.stringify(resp))
                    toast.success(t('common.ok'))
                  } catch (err) {
                    toast.error(errorMessage(err, t))
                  }
                }}
              >
                {t('characters.loadTitles')}
              </button>
            </div>
            {titlesResult && (
              <div className="alert alert-info items-start">
                <div>
                  <div className="font-semibold">{t('characters.titles')}</div>
                  <pre className="m-0 whitespace-pre-wrap text-xs">{titlesResult}</pre>
                </div>
              </div>
            )}

            {hasMinRole('gm') && (
              <>
                <div className="divider">{t('characters.sendMoney')}</div>
                <div className="alert alert-info text-sm">
                  <span>{t('characters.moneyHint')}</span>
                </div>
                <form
                  className="flex flex-wrap items-start gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    const money = moneyInput.trim()
                    if (!money) {
                      toast.error(t('validation.required'))
                      return
                    }
                    setConfirm({
                      title: t('characters.sendMoney'),
                      description: t('characters.moneyConfirm', { name: detail.name, money }),
                      run: async () => {
                        await api(`/api/v1/characters/${encodeURIComponent(detail.name)}/money`, {
                          method: 'POST',
                          body: JSON.stringify({ money, confirm: true }),
                        })
                        void loadInventory(detail.name)
                      },
                    })
                  }}
                >
                  <label className="form-control">
                    <input
                      className="input input-bordered input-sm w-40"
                      placeholder="1g2s3c"
                      value={moneyInput}
                      onChange={(e) => setMoneyInput(e.target.value)}
                    />
                    <span className="text-xs text-base-content/60 mt-1">1g2s3c</span>
                  </label>
                  <button type="submit" className="btn btn-sm btn-primary">
                    {t('characters.sendMoney')}
                  </button>
                </form>

                <div className="divider">{t('characters.sendItem')}</div>
                <div className="alert alert-info text-sm">
                  <span>{t('characters.itemHint')}</span>
                </div>
                <form
                  className="flex flex-wrap items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (itemId == null || !itemCount) {
                      toast.error(t('validation.required'))
                      return
                    }
                    setConfirm({
                      title: t('characters.sendItem'),
                      description: t('characters.itemConfirm', {
                        name: detail.name,
                        item: itemId,
                        count: itemCount,
                      }),
                      run: async () => {
                        await api(`/api/v1/characters/${encodeURIComponent(detail.name)}/items`, {
                          method: 'POST',
                          body: JSON.stringify({
                            action: 'send',
                            item_id: itemId,
                            count: itemCount,
                            confirm: true,
                          }),
                        })
                        void loadInventory(detail.name)
                      },
                    })
                  }}
                >
                  <div className="w-72">
                    <ItemSelect value={itemId ?? undefined} onChange={(v) => setItemId(v)} />
                  </div>
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    className="input input-bordered input-sm w-24"
                    value={itemCount}
                    onChange={(e) => setItemCount(Number(e.target.value))}
                  />
                  <button type="submit" className="btn btn-sm btn-primary">
                    {t('characters.sendItem')}
                  </button>
                </form>
              </>
            )}

            <div className="divider">{t('characters.equipment')}</div>
            <Tabs items={detailTabs} />
          </div>
        )}
      </Drawer>

      <div className="divider" />
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h3 className="text-lg font-semibold m-0">{t('characters.deleted')}</h3>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="input input-bordered input-sm w-44"
            placeholder={t('characters.searchName')}
            value={deletedQ}
            onChange={(e) => setDeletedQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void loadDeleted()
            }}
          />
          <button type="button" className="btn btn-sm" onClick={() => void loadDeleted()}>
            {t('common.refresh')}
          </button>
          {hasMinRole('superadmin') && (
            <span className="tooltip tooltip-left" data-tip={t('characters.purgeHint')}>
              <button
                type="button"
                className="btn btn-sm btn-error"
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
              </button>
            </span>
          )}
        </div>
      </div>
      <DataTable
        loading={deletedLoading}
        rowKey="guid"
        dataSource={deletedItems}
        pagination={{ pageSize: 20 }}
        columns={deletedColumns}
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
        onSubmit={(acc) => {
          if (!changeAccountTarget) return
          setConfirm({
            title: t('characters.changeAccount'),
            description: t('characters.changeAccountConfirm', {
              name: changeAccountTarget.name,
              account: acc,
            }),
            run: async () => {
              await api(`/api/v1/characters/${encodeURIComponent(changeAccountTarget.name)}/changeaccount`, {
                method: 'POST',
                body: JSON.stringify({ account: acc, confirm: true }),
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
            toast.success(t('common.ok'))
            setConfirm(null)
            void load(data?.offset ?? 0)
          } catch (err) {
            toast.error(errorMessage(err, t))
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
  const [level, setLevel] = useState(1)

  useEffect(() => {
    if (character) setLevel(character.level ?? 1)
  }, [character])

  return (
    <Modal
      open={!!character}
      title={t('characters.setLevel')}
      onClose={onClose}
      onOk={() => {
        if (!Number.isFinite(level) || level < 1 || level > 80) {
          toast.error(t('validation.required'))
          return
        }
        onSubmit(level)
      }}
    >
      <label className="form-control w-full">
        <span className="label-text mb-1">{t('characters.level')}</span>
        <input
          type="number"
          min={1}
          max={80}
          className="input input-bordered w-full"
          value={level}
          onChange={(e) => setLevel(Number(e.target.value))}
        />
      </label>
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
  const [account, setAccount] = useState('')

  useEffect(() => {
    if (character) setAccount('')
  }, [character])

  return (
    <Modal
      open={!!character}
      title={t('characters.changeAccount')}
      onClose={onClose}
      onOk={() => {
        if (!account.trim()) {
          toast.error(t('validation.required'))
          return
        }
        onSubmit(account.trim())
      }}
    >
      <div className="flex flex-col gap-3">
        <label className="form-control w-full">
          <span className="label-text mb-1">{t('characters.name')}</span>
          <input className="input input-bordered w-full" value={character?.name ?? ''} disabled />
        </label>
        <label className="form-control w-full">
          <span className="label-text mb-1">{t('characters.targetAccount')}</span>
          <input
            className="input input-bordered w-full"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
          />
        </label>
      </div>
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
  const [newName, setNewName] = useState('')

  useEffect(() => {
    if (character) setNewName('')
  }, [character])

  return (
    <Modal
      open={!!character}
      title={t('characters.setName')}
      onClose={onClose}
      onOk={() => {
        if (!newName.trim()) {
          toast.error(t('validation.required'))
          return
        }
        onSubmit(newName.trim())
      }}
    >
      <div className="flex flex-col gap-3">
        <div className="alert alert-info text-sm">
          <span>{t('characters.setNameHint')}</span>
        </div>
        <label className="form-control w-full">
          <span className="label-text mb-1">{t('characters.name')}</span>
          <input className="input input-bordered w-full" value={character?.name ?? ''} disabled />
        </label>
        <label className="form-control w-full">
          <span className="label-text mb-1">{t('characters.newName')}</span>
          <input
            className="input input-bordered w-full"
            maxLength={16}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
        </label>
      </div>
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
  const [location, setLocation] = useState('')

  useEffect(() => {
    if (character) setLocation('')
  }, [character])

  return (
    <Modal
      open={!!character}
      title={t('characters.tele')}
      onClose={onClose}
      onOk={() => {
        if (!location) {
          toast.error(t('validation.required'))
          return
        }
        onSubmit(location)
      }}
    >
      <div className="flex flex-col gap-3">
        <div className="alert alert-info text-sm">
          <span>{t('characters.teleHint')}</span>
        </div>
        <label className="form-control w-full">
          <span className="label-text mb-1">{t('characters.name')}</span>
          <input className="input input-bordered w-full" value={character?.name ?? ''} disabled />
        </label>
        <div className="form-control w-full">
          <span className="label-text mb-1">{t('characters.teleLocation')}</span>
          <TeleSelect className="w-full" value={location || undefined} onChange={(v) => setLocation(v ?? '')} />
        </div>
      </div>
    </Modal>
  )
}
