import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, errorMessage, hasMinRole } from '../api/client'
import { ConfirmDanger } from '../components/ConfirmDanger'
import { MapSelect } from '../components/PlaceSelect'
import { DataTable, Select, toast, type Column } from '../ui'

type DisableRow = {
  source_type: number
  source_type_name?: string
  entry: number
  entry_name?: string
  flags: number
  flags_text?: string
  params_0: string
  params_1: string
  comment: string
  comment_en?: string
}

type EventRow = {
  id: number
  name: string
  name_en: string
  active: boolean
  raw: string
}

export function EventsPage() {
  const { t, i18n } = useTranslation()
  const [events, setEvents] = useState<EventRow[]>([])
  const [eventsLoading, setEventsLoading] = useState(false)
  const [disables, setDisables] = useState<DisableRow[]>([])
  const [disablesLoading, setDisablesLoading] = useState(false)
  const [pending, setPending] = useState<{ title: string; description: string; run: () => Promise<void> } | null>(null)

  const [eventAction, setEventAction] = useState('start')
  const [eventId, setEventId] = useState('')

  const [disableAction, setDisableAction] = useState('add')
  const [disableType, setDisableType] = useState('spell')
  const [disableEntry, setDisableEntry] = useState<number | undefined>(undefined)
  const [disableFlag, setDisableFlag] = useState('0')
  const [disableComment, setDisableComment] = useState('')

  const load = useCallback(async () => {
    setEventsLoading(true)
    try {
      const data = await api<{ items: EventRow[]; raw: string }>('/api/v1/events')
      setEvents(data.items ?? [])
    } catch (err) {
      toast.error(errorMessage(err, t))
    } finally {
      setEventsLoading(false)
    }
  }, [t])

  const loadDisables = useCallback(async () => {
    setDisablesLoading(true)
    try {
      const data = await api<{ items: DisableRow[] }>('/api/v1/disables?limit=200')
      setDisables(data.items)
    } catch (err) {
      toast.error(errorMessage(err, t))
    } finally {
      setDisablesLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
    void loadDisables()
  }, [load, loadDisables, i18n.language])

  const usesMapPicker = ['map', 'vmap', 'battleground'].includes(disableType)

  const eventColumns: Column<EventRow>[] = [
    { key: 'id', title: t('events.eventId'), dataIndex: 'id', width: 90 },
    {
      key: 'name',
      title: t('events.name'),
      dataIndex: 'name',
      render: (v) => <span className="block max-w-[420px] truncate">{String(v ?? '')}</span>,
    },
    {
      key: 'active',
      title: t('events.status'),
      dataIndex: 'active',
      width: 100,
      render: (v) => ((v as boolean) ? t('events.active') : t('events.inactive')),
    },
    ...(hasMinRole('gm')
      ? [
          {
            key: 'actions',
            title: t('common.actions'),
            width: 160,
            render: (_v: unknown, row: EventRow) => (
              <div className="flex gap-1">
                <button
                  type="button"
                  className="btn btn-primary btn-xs"
                  onClick={() =>
                    setPending({
                      title: t('events.action'),
                      description: `${t('common.start')} #${row.id} ${row.name}`,
                      run: async () => {
                        await api('/api/v1/events', {
                          method: 'POST',
                          body: JSON.stringify({ action: 'start', event_id: row.id, confirm: true }),
                        })
                        await load()
                      },
                    })
                  }
                >
                  {t('common.start')}
                </button>
                <button
                  type="button"
                  className="btn btn-error btn-xs"
                  onClick={() =>
                    setPending({
                      title: t('events.action'),
                      description: `${t('common.stop')} #${row.id} ${row.name}`,
                      run: async () => {
                        await api('/api/v1/events', {
                          method: 'POST',
                          body: JSON.stringify({ action: 'stop', event_id: row.id, confirm: true }),
                        })
                        await load()
                      },
                    })
                  }
                >
                  {t('common.stop')}
                </button>
              </div>
            ),
          } satisfies Column<EventRow>,
        ]
      : []),
  ]

  const disableColumns: Column<DisableRow>[] = [
    {
      key: 'source_type',
      title: t('events.sourceType'),
      width: 120,
      render: (_v, r) => (r.source_type_name ? `${r.source_type_name} (#${r.source_type})` : r.source_type),
    },
    {
      key: 'entry',
      title: t('common.entry'),
      width: 220,
      render: (_v, r) => (
        <span className="block max-w-[220px] truncate">
          {r.entry_name ? `${r.entry_name} (#${r.entry})` : `#${r.entry}`}
        </span>
      ),
    },
    {
      key: 'flags',
      title: t('common.flags'),
      width: 200,
      render: (_v, r) => (
        <span className="block max-w-[200px] truncate">{r.flags_text ? `${r.flags_text} (${r.flags})` : r.flags}</span>
      ),
    },
    {
      key: 'params_0',
      title: t('common.params0'),
      dataIndex: 'params_0',
      render: (v) => <span className="block max-w-[200px] truncate">{String(v ?? '')}</span>,
    },
    {
      key: 'params_1',
      title: t('common.params1'),
      dataIndex: 'params_1',
      render: (v) => <span className="block max-w-[200px] truncate">{String(v ?? '')}</span>,
    },
    {
      key: 'comment',
      title: t('moderation.reason'),
      dataIndex: 'comment',
      render: (v) => <span className="block max-w-[240px] truncate">{String(v ?? '')}</span>,
    },
  ]

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h1 className="text-2xl font-semibold m-0">{t('pages.events.title')}</h1>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            void load()
            void loadDisables()
          }}
        >
          {t('common.refresh')}
        </button>
      </div>

      <div className="alert alert-info mb-4">
        <span>{t('events.hint')}</span>
      </div>

      <div className="mb-4">
        <DataTable
          rowKey="id"
          loading={eventsLoading}
          dataSource={events}
          columns={eventColumns}
          pagination={false}
        />
      </div>

      {hasMinRole('gm') && (
        <form
          className="flex flex-wrap items-center gap-2 mt-2 mb-2"
          onSubmit={(e) => {
            e.preventDefault()
            const values = { action: eventAction, event_id: Number(eventId) }
            setPending({
              title: t('events.action'),
              description: `${values.action} #${values.event_id}`,
              run: async () => {
                await api('/api/v1/events', {
                  method: 'POST',
                  body: JSON.stringify({ ...values, confirm: true }),
                })
                await load()
              },
            })
          }}
        >
          <Select
            className="w-32"
            value={eventAction}
            onChange={(v) => setEventAction(v ?? 'start')}
            options={[
              { value: 'start', label: t('common.start') },
              { value: 'stop', label: t('common.stop') },
            ]}
          />
          <input
            type="number"
            min={1}
            required
            className="input input-bordered w-40"
            placeholder={t('events.eventId')}
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
          />
          <button type="submit" className="btn btn-primary">
            {t('events.action')}
          </button>
        </form>
      )}

      <h2 className="text-lg font-semibold mt-8 mb-3">{t('events.disables')}</h2>

      {hasMinRole('gm') && (
        <form
          className="flex flex-wrap items-center gap-2 mb-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (disableAction !== 'reload' && disableEntry == null) {
              toast.error(t('validation.required'))
              return
            }
            const values =
              disableAction === 'reload'
                ? { action: disableAction }
                : {
                    action: disableAction,
                    type: disableType,
                    entry: disableEntry,
                    ...(disableAction === 'add'
                      ? {
                          flag: disableFlag === '' ? undefined : Number(disableFlag),
                          comment: disableComment,
                        }
                      : {}),
                  }
            setPending({
              title: t('events.disables'),
              description: t('events.disableConfirm', {
                action: disableAction,
                type: disableAction === 'reload' ? '' : disableType,
                entry: disableAction === 'reload' ? '' : (disableEntry ?? ''),
              }),
              run: async () => {
                await api('/api/v1/disables', {
                  method: 'POST',
                  body: JSON.stringify({ ...values, confirm: true }),
                })
                await loadDisables()
              },
            })
          }}
        >
          <Select
            className="w-28"
            value={disableAction}
            onChange={(v) => setDisableAction(v ?? 'add')}
            options={[
              { value: 'add', label: t('common.add') },
              { value: 'remove', label: t('common.remove') },
              { value: 'reload', label: t('common.reload') },
            ]}
          />
          {disableAction !== 'reload' && (
            <>
              <Select
                className="w-36"
                value={disableType}
                onChange={(v) => {
                  setDisableType(v ?? 'spell')
                  setDisableEntry(undefined)
                }}
                options={[
                  { value: 'spell', label: t('events.typeSpell') },
                  { value: 'map', label: t('events.typeMap') },
                  { value: 'battleground', label: t('events.typeBattleground') },
                  { value: 'quest', label: t('events.typeQuest') },
                  { value: 'vmap', label: t('events.typeVmap') },
                  { value: 'outdoorpvp', label: t('events.typeOutdoorpvp') },
                ]}
              />
              {usesMapPicker ? (
                <MapSelect
                  className="w-60"
                  value={disableEntry}
                  onChange={(v) => setDisableEntry(v ?? undefined)}
                />
              ) : (
                <input
                  type="number"
                  min={1}
                  required
                  className="input input-bordered w-40"
                  placeholder={t('common.entry')}
                  value={disableEntry ?? ''}
                  onChange={(e) => setDisableEntry(e.target.value === '' ? undefined : Number(e.target.value))}
                />
              )}
              {disableAction === 'add' && (
                <>
                  <input
                    type="number"
                    min={0}
                    className="input input-bordered w-32"
                    placeholder={t('accounts.flag')}
                    value={disableFlag}
                    onChange={(e) => setDisableFlag(e.target.value)}
                  />
                  <input
                    className="input input-bordered w-36"
                    placeholder={t('moderation.reason')}
                    value={disableComment}
                    onChange={(e) => setDisableComment(e.target.value)}
                  />
                </>
              )}
            </>
          )}
          <button type="submit" className="btn">
            {t('events.disableAction')}
          </button>
        </form>
      )}

      <DataTable
        rowKey={(r) => `${r.source_type}-${r.entry}`}
        loading={disablesLoading}
        dataSource={disables}
        columns={disableColumns}
        pagination={{ pageSize: 20 }}
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
