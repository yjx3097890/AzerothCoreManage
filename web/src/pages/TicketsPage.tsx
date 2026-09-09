import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, errorMessage, hasMinRole } from '../api/client'
import { ConfirmDanger } from '../components/ConfirmDanger'
import { DataTable, Drawer, toast, type Column } from '../ui'

type Ticket = {
  id: number
  name: string
  description: string
  online: number
  completed: number
  assigned_to: number
  comment: string
  response: string
  map_id: number
  create_time: number
}

export function TicketsPage() {
  const { t } = useTranslation()
  const [items, setItems] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(false)
  const [onlineOnly, setOnlineOnly] = useState(false)
  const [detail, setDetail] = useState<Ticket | null>(null)
  const [pending, setPending] = useState<{ title: string; description: string; run: () => Promise<void> } | null>(null)
  const [comment, setComment] = useState('')
  const [gmName, setGmName] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ open: '1' })
      if (onlineOnly) params.set('online', '1')
      const data = await api<{ items: Ticket[] }>(`/api/v1/tickets?${params}`)
      setItems(data.items)
    } catch (err) {
      toast.error(errorMessage(err, t))
    } finally {
      setLoading(false)
    }
  }, [onlineOnly, t])

  useEffect(() => {
    void load()
  }, [load])

  const columns: Column<Ticket>[] = [
    { key: 'id', title: 'ID', dataIndex: 'id', width: 70 },
    { key: 'name', title: t('characters.name'), dataIndex: 'name' },
    {
      key: 'description',
      title: t('tickets.description'),
      dataIndex: 'description',
      render: (v) => <span className="block max-w-[420px] truncate">{String(v ?? '')}</span>,
    },
    {
      key: 'online',
      title: t('characters.online'),
      dataIndex: 'online',
      width: 80,
      render: (v) => ((v as number) ? <span className="badge badge-success badge-sm">{t('common.yes')}</span> : t('common.no')),
    },
    {
      key: 'actions',
      title: t('common.actions'),
      render: (_v, row) => (
        <button
          type="button"
          className="btn btn-xs"
          onClick={async () => {
            try {
              setComment('')
              setGmName('')
              setDetail(await api<Ticket>(`/api/v1/tickets/${row.id}`))
            } catch (err) {
              toast.error(errorMessage(err, t))
            }
          }}
        >
          {t('tickets.detail')}
        </button>
      ),
    },
  ]

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h1 className="text-2xl font-semibold m-0">{t('pages.tickets.title')}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <span className="text-sm">{t('tickets.onlineOnly')}</span>
            <input
              type="checkbox"
              className="toggle toggle-sm"
              checked={onlineOnly}
              onChange={(e) => setOnlineOnly(e.target.checked)}
            />
          </label>
          <button type="button" className="btn btn-sm" onClick={() => void load()}>
            {t('common.refresh')}
          </button>
          {hasMinRole('superadmin') && (
            <>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() =>
                  setPending({
                    title: t('tickets.toggleSystem'),
                    description: t('tickets.toggleConfirm'),
                    run: async () => {
                      await api('/api/v1/tickets/system', {
                        method: 'POST',
                        body: JSON.stringify({ action: 'toggle', confirm: true }),
                      })
                    },
                  })
                }
              >
                {t('tickets.toggleSystem')}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-error"
                onClick={() =>
                  setPending({
                    title: t('tickets.reset'),
                    description: t('tickets.resetConfirm'),
                    run: async () => {
                      await api('/api/v1/tickets/system', {
                        method: 'POST',
                        body: JSON.stringify({ action: 'reset', confirm: true }),
                      })
                    },
                  })
                }
              >
                {t('tickets.reset')}
              </button>
            </>
          )}
        </div>
      </div>

      <DataTable rowKey="id" loading={loading} dataSource={items} columns={columns} />

      <Drawer
        open={!!detail}
        width={520}
        title={`#${detail?.id ?? ''} ${detail?.name ?? ''}`}
        onClose={() => setDetail(null)}
      >
        {detail && (
          <div className="flex flex-col gap-6">
            <div className="overflow-x-auto rounded-box border border-base-300">
              <table className="table table-zebra table-sm">
                <tbody>
                  <tr>
                    <th className="w-32 align-top">{t('tickets.description')}</th>
                    <td className="whitespace-pre-wrap">{detail.description}</td>
                  </tr>
                  <tr>
                    <th className="align-top">{t('tickets.comment')}</th>
                    <td className="whitespace-pre-wrap">{detail.comment || '-'}</td>
                  </tr>
                  <tr>
                    <th className="align-top">{t('tickets.response')}</th>
                    <td className="whitespace-pre-wrap">{detail.response || '-'}</td>
                  </tr>
                  <tr>
                    <th className="align-top">{t('characters.map')}</th>
                    <td>{detail.map_id}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {hasMinRole('gm') && (
              <>
                <form
                  className="flex flex-col gap-2"
                  onSubmit={async (e) => {
                    e.preventDefault()
                    try {
                      await api(`/api/v1/tickets/${detail.id}/comment`, {
                        method: 'POST',
                        body: JSON.stringify({ comment }),
                      })
                      toast.success(t('common.ok'))
                      setComment('')
                      setDetail(await api<Ticket>(`/api/v1/tickets/${detail.id}`))
                    } catch (err) {
                      toast.error(errorMessage(err, t))
                    }
                  }}
                >
                  <label className="form-control w-full">
                    <span className="label-text mb-1">{t('tickets.addComment')}</span>
                    <textarea
                      className="textarea textarea-bordered w-full"
                      rows={2}
                      required
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                    />
                  </label>
                  <div>
                    <button type="submit" className="btn btn-sm">
                      {t('tickets.addComment')}
                    </button>
                  </div>
                </form>

                <form
                  className="flex flex-wrap items-center gap-2"
                  onSubmit={async (e) => {
                    e.preventDefault()
                    try {
                      await api(`/api/v1/tickets/${detail.id}/assign`, {
                        method: 'POST',
                        body: JSON.stringify({ action: 'assign', gm_name: gmName }),
                      })
                      toast.success(t('common.ok'))
                    } catch (err) {
                      toast.error(errorMessage(err, t))
                    }
                  }}
                >
                  <input
                    className="input input-bordered input-sm flex-1 min-w-[160px]"
                    required
                    placeholder={t('tickets.gmName')}
                    value={gmName}
                    onChange={(e) => setGmName(e.target.value)}
                  />
                  <button type="submit" className="btn btn-sm">
                    {t('tickets.assign')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() =>
                      setPending({
                        title: t('tickets.unassign'),
                        description: t('tickets.unassignConfirm', { id: detail.id }),
                        run: async () => {
                          await api(`/api/v1/tickets/${detail.id}/assign`, {
                            method: 'POST',
                            body: JSON.stringify({ action: 'unassign' }),
                          })
                        },
                      })
                    }
                  >
                    {t('tickets.unassign')}
                  </button>
                </form>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn btn-sm btn-error"
                    onClick={() =>
                      setPending({
                        title: t('tickets.close'),
                        description: t('tickets.closeConfirm', { id: detail.id }),
                        run: async () => {
                          await api(`/api/v1/tickets/${detail.id}/close`, {
                            method: 'POST',
                            body: JSON.stringify({ action: 'close', confirm: true }),
                          })
                          setDetail(null)
                        },
                      })
                    }
                  >
                    {t('tickets.close')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() =>
                      setPending({
                        title: t('tickets.complete'),
                        description: t('tickets.completeConfirm', { id: detail.id }),
                        run: async () => {
                          await api(`/api/v1/tickets/${detail.id}/close`, {
                            method: 'POST',
                            body: JSON.stringify({ action: 'complete', confirm: true }),
                          })
                          setDetail(null)
                        },
                      })
                    }
                  >
                    {t('tickets.complete')}
                  </button>
                  {hasMinRole('superadmin') && (
                    <button
                      type="button"
                      className="btn btn-sm btn-error"
                      onClick={() =>
                        setPending({
                          title: t('tickets.delete'),
                          description: t('tickets.deleteConfirm', { id: detail.id }),
                          run: async () => {
                            await api(`/api/v1/tickets/${detail.id}`, {
                              method: 'DELETE',
                              body: JSON.stringify({ confirm: true }),
                            })
                            setDetail(null)
                          },
                        })
                      }
                    >
                      {t('tickets.delete')}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}
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
            void load()
          } catch (err) {
            toast.error(errorMessage(err, t))
          }
        }}
      />
    </div>
  )
}
