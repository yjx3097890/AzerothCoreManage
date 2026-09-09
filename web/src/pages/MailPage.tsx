import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, errorMessage, hasMinRole } from '../api/client'
import { ConfirmDanger } from '../components/ConfirmDanger'
import { ItemSelect } from '../components/ItemSelect'
import { DataTable, Select, Tabs, toast, type Column } from '../ui'

type MailItemRow = { item_id?: number; count?: number }

type MailRow = {
  id: number
  sender_name: string
  subject: string
  body: string
  money: number
  has_items: boolean
  deliver_time?: string
  expire_time?: string
  items: Array<{ item_entry: number; count: number; name: string }>
}

const MAX_ITEM_ROWS = 12

function moneyStr(copper: number) {
  const g = Math.floor(copper / 10000)
  const s = Math.floor((copper % 10000) / 100)
  const c = copper % 100
  return `${g}g ${s}s ${c}c`
}

type ItemRowsProps = {
  rows: MailItemRow[]
  onChange: (rows: MailItemRow[]) => void
}

function ItemRows({ rows, onChange }: ItemRowsProps) {
  const { t } = useTranslation()

  const update = (index: number, patch: Partial<MailItemRow>) => {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  return (
    <>
      {rows.map((row, index) => (
        <div key={index} className="flex flex-wrap items-end gap-2 mb-2">
          <label className="form-control">
            <span className="label-text mb-1">{t('mail.itemId')}</span>
            <ItemSelect
              className="w-[280px]"
              value={row.item_id}
              onChange={(v) => update(index, { item_id: v ?? undefined })}
            />
          </label>
          <label className="form-control">
            <span className="label-text mb-1">{t('mail.count')}</span>
            <input
              type="number"
              min={1}
              max={1000}
              required
              className="input input-bordered w-24"
              value={row.count ?? ''}
              onChange={(e) => update(index, { count: e.target.value === '' ? undefined : Number(e.target.value) })}
            />
          </label>
          {rows.length > 1 && (
            <button
              type="button"
              className="btn btn-ghost btn-sm text-error"
              onClick={() => onChange(rows.filter((_, i) => i !== index))}
            >
              {t('common.remove')}
            </button>
          )}
        </div>
      ))}
      {rows.length < MAX_ITEM_ROWS && (
        <button
          type="button"
          className="btn btn-outline btn-dash btn-sm mb-3"
          onClick={() => onChange([...rows, { count: 1 }])}
        >
          {t('mail.addItem')}
        </button>
      )}
    </>
  )
}

export function MailPage() {
  const { t } = useTranslation()
  const [pending, setPending] = useState<{ kind: 'send' | 'bulk' | 'delete'; payload: unknown; desc: string } | null>(
    null,
  )

  const [mode, setMode] = useState('mail')
  const [player, setPlayer] = useState('')
  const [subject, setSubject] = useState('GM')
  const [body, setBody] = useState('')
  const [money, setMoney] = useState('')
  const [items, setItems] = useState<MailItemRow[]>([{ item_id: undefined, count: 1 }])

  const [bulkMode, setBulkMode] = useState('mail')
  const [playersText, setPlayersText] = useState('')
  const [bulkSubject, setBulkSubject] = useState('GM')
  const [bulkBody, setBulkBody] = useState('')
  const [bulkMoney, setBulkMoney] = useState('')
  const [bulkItems, setBulkItems] = useState<MailItemRow[]>([{ count: 1 }])
  const [delayMs, setDelayMs] = useState('150')

  const [playerQ, setPlayerQ] = useState('')
  const [mailLoading, setMailLoading] = useState(false)
  const [online, setOnline] = useState<number | null>(null)
  const [mails, setMails] = useState<MailRow[]>([])

  const loadMails = useCallback(async () => {
    const name = playerQ.trim()
    if (!name) return
    setMailLoading(true)
    try {
      const data = await api<{ items: MailRow[]; online: number }>(
        `/api/v1/mail?player=${encodeURIComponent(name)}&limit=50`,
      )
      setMails(data.items)
      setOnline(data.online)
    } catch (err) {
      toast.error(errorMessage(err, t))
      setMails([])
      setOnline(null)
    } finally {
      setMailLoading(false)
    }
  }, [playerQ, t])

  const buildSendBody = (values: {
    mode: string
    player: string
    subject: string
    body: string
    money?: string
    items: MailItemRow[]
  }) => {
    const itemList = values.items
      .filter((i) => i.item_id && i.item_id > 0)
      .map((i) => ({ item_id: i.item_id!, count: i.count || 1 }))
    return {
      mode: values.mode,
      player: values.player,
      subject: values.subject,
      body: values.body || '',
      item_id: undefined,
      count: 1,
      items: itemList,
      money: values.money,
      confirm: true,
    }
  }

  const modeOptions = [
    { value: 'mail', label: t('mail.modeMail') },
    { value: 'items', label: t('mail.modeItems') },
    { value: 'money', label: t('mail.modeMoney') },
    { value: 'both', label: t('mail.modeBoth') },
  ]

  const mailColumns: Column<MailRow>[] = [
    { key: 'id', title: 'ID', dataIndex: 'id', width: 80 },
    { key: 'sender_name', title: t('mail.sender'), dataIndex: 'sender_name', width: 120 },
    {
      key: 'subject',
      title: t('mail.subject'),
      render: (_v, row) => (
        <details className="collapse collapse-arrow bg-base-200/60 rounded-box">
          <summary className="collapse-title min-h-0 py-2 px-3 text-sm font-medium">{row.subject}</summary>
          <div className="collapse-content text-sm">
            <p className="whitespace-pre-wrap">{row.body || '-'}</p>
            {row.items?.length > 0 && (
              <ul className="list-disc pl-5">
                {row.items.map((it) => (
                  <li key={`${row.id}-${it.item_entry}-${it.count}`}>
                    [{it.item_entry}] {it.name || '-'} × {it.count}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>
      ),
    },
    {
      key: 'money',
      title: t('mail.money'),
      dataIndex: 'money',
      width: 120,
      render: (v) => moneyStr((v as number) || 0),
    },
    {
      key: 'has_items',
      title: t('mail.items'),
      dataIndex: 'has_items',
      width: 80,
      render: (v) => ((v as boolean) ? t('common.yes') : t('common.no')),
    },
    {
      key: 'actions',
      title: t('common.actions'),
      width: 100,
      render: (_v, row) =>
        hasMinRole('gm') ? (
          <button
            type="button"
            className="btn btn-error btn-xs"
            disabled={!!online}
            onClick={() =>
              setPending({
                kind: 'delete',
                payload: { id: row.id },
                desc: t('mail.deleteConfirm', { id: row.id, player: playerQ }),
              })
            }
          >
            {t('common.delete')}
          </button>
        ) : null,
    },
  ]

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">{t('pages.mail.title')}</h1>
      <Tabs
        items={[
          {
            key: 'send',
            label: t('mail.tabSend'),
            children: (
              <div className="max-w-[640px]">
                <form
                  className="flex flex-col gap-3"
                  onSubmit={(e) => {
                    e.preventDefault()
                    setPending({
                      kind: 'send',
                      payload: buildSendBody({ mode, player, subject, body, money, items }),
                      desc: t('mail.sendConfirm', { player, mode }),
                    })
                  }}
                >
                  <label className="form-control w-full">
                    <span className="label-text mb-1">{t('mail.mode')}</span>
                    <Select value={mode} onChange={(v) => setMode(v ?? 'mail')} options={modeOptions} />
                  </label>
                  <label className="form-control w-full">
                    <span className="label-text mb-1">{t('characters.name')}</span>
                    <input
                      className="input input-bordered w-full"
                      required
                      value={player}
                      onChange={(e) => setPlayer(e.target.value)}
                    />
                  </label>
                  <label className="form-control w-full">
                    <span className="label-text mb-1">{t('mail.subject')}</span>
                    <input
                      className="input input-bordered w-full"
                      required
                      maxLength={64}
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                    />
                  </label>
                  <label className="form-control w-full">
                    <span className="label-text mb-1">{t('mail.body')}</span>
                    <textarea
                      className="textarea textarea-bordered w-full"
                      rows={3}
                      maxLength={500}
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                    />
                  </label>
                  {(mode === 'items' || mode === 'both') && <ItemRows rows={items} onChange={setItems} />}
                  {(mode === 'money' || mode === 'both') && (
                    <label className="form-control w-full">
                      <span className="label-text mb-1">{t('mail.money')}</span>
                      <input
                        className="input input-bordered w-full"
                        required
                        placeholder="1g2s3c"
                        value={money}
                        onChange={(e) => setMoney(e.target.value)}
                      />
                      <span className="label-text-alt text-base-content/60 mt-1">1g2s3c</span>
                    </label>
                  )}
                  <div>
                    <button type="submit" className="btn btn-primary" disabled={!hasMinRole('gm')}>
                      {t('mail.send')}
                    </button>
                  </div>
                </form>
              </div>
            ),
          },
          {
            key: 'bulk',
            label: t('mail.tabBulk'),
            children: (
              <div className="max-w-[640px]">
                <div className="alert alert-warning mb-3">
                  <span>{t('mail.bulkHint')}</span>
                </div>
                <form
                  className="flex flex-col gap-3"
                  onSubmit={(e) => {
                    e.preventDefault()
                    const players = playersText
                      .split(/[\n,;]+/)
                      .map((s) => s.trim())
                      .filter(Boolean)
                    setPending({
                      kind: 'bulk',
                      payload: {
                        ...buildSendBody({
                          mode: bulkMode,
                          player: players[0] || '',
                          subject: bulkSubject,
                          body: bulkBody,
                          money: bulkMoney,
                          items: bulkItems,
                        }),
                        players,
                        delay_ms: delayMs === '' ? undefined : Number(delayMs),
                      },
                      desc: t('mail.bulkConfirm', { count: players.length, mode: bulkMode }),
                    })
                  }}
                >
                  <label className="form-control w-full">
                    <span className="label-text mb-1">{t('mail.mode')}</span>
                    <Select value={bulkMode} onChange={(v) => setBulkMode(v ?? 'mail')} options={modeOptions} />
                  </label>
                  <label className="form-control w-full">
                    <span className="label-text mb-1">{t('mail.players')}</span>
                    <textarea
                      className="textarea textarea-bordered w-full"
                      rows={5}
                      required
                      placeholder={t('mail.playersPlaceholder')}
                      value={playersText}
                      onChange={(e) => setPlayersText(e.target.value)}
                    />
                    <span className="label-text-alt text-base-content/60 mt-1">{t('mail.playersHint')}</span>
                  </label>
                  <label className="form-control w-full">
                    <span className="label-text mb-1">{t('mail.subject')}</span>
                    <input
                      className="input input-bordered w-full"
                      required
                      maxLength={64}
                      value={bulkSubject}
                      onChange={(e) => setBulkSubject(e.target.value)}
                    />
                  </label>
                  <label className="form-control w-full">
                    <span className="label-text mb-1">{t('mail.body')}</span>
                    <textarea
                      className="textarea textarea-bordered w-full"
                      rows={3}
                      maxLength={500}
                      value={bulkBody}
                      onChange={(e) => setBulkBody(e.target.value)}
                    />
                  </label>
                  {(bulkMode === 'items' || bulkMode === 'both') && (
                    <ItemRows rows={bulkItems} onChange={setBulkItems} />
                  )}
                  {(bulkMode === 'money' || bulkMode === 'both') && (
                    <label className="form-control w-full">
                      <span className="label-text mb-1">{t('mail.money')}</span>
                      <input
                        className="input input-bordered w-full"
                        required
                        placeholder="1g2s3c"
                        value={bulkMoney}
                        onChange={(e) => setBulkMoney(e.target.value)}
                      />
                      <span className="label-text-alt text-base-content/60 mt-1">1g2s3c</span>
                    </label>
                  )}
                  <label className="form-control">
                    <span className="label-text mb-1">{t('mail.delayMs')}</span>
                    <input
                      type="number"
                      min={50}
                      max={2000}
                      className="input input-bordered w-40"
                      value={delayMs}
                      onChange={(e) => setDelayMs(e.target.value)}
                    />
                  </label>
                  <div>
                    <button type="submit" className="btn btn-primary" disabled={!hasMinRole('gm')}>
                      {t('mail.bulkSend')}
                    </button>
                  </div>
                </form>
              </div>
            ),
          },
          {
            key: 'inbox',
            label: t('mail.tabInbox'),
            children: (
              <div>
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <input
                    className="input input-bordered w-56"
                    placeholder={t('characters.name')}
                    value={playerQ}
                    onChange={(e) => setPlayerQ(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void loadMails()
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={mailLoading}
                    onClick={() => void loadMails()}
                  >
                    {mailLoading && <span className="loading loading-spinner loading-sm" />}
                    {t('common.search')}
                  </button>
                  {online !== null && (
                    <div className={`alert py-2 w-auto ${online ? 'alert-warning' : 'alert-success'}`}>
                      <span>{online ? t('mail.receiverOnline') : t('mail.receiverOffline')}</span>
                    </div>
                  )}
                </div>
                <div className="alert alert-info mb-3">
                  <span>{t('mail.inboxHint')}</span>
                </div>
                <DataTable
                  rowKey="id"
                  loading={mailLoading}
                  dataSource={mails}
                  columns={mailColumns}
                  pagination={false}
                />
              </div>
            ),
          },
        ]}
      />

      <ConfirmDanger
        open={!!pending}
        description={pending?.desc}
        onCancel={() => setPending(null)}
        onConfirm={async () => {
          if (!pending) return
          try {
            if (pending.kind === 'send') {
              await api('/api/v1/mail/send', { method: 'POST', body: JSON.stringify(pending.payload) })
              toast.success(t('common.ok'))
              setPlayer('')
              setBody('')
              setMoney('')
            } else if (pending.kind === 'bulk') {
              const data = await api<{ total: number; ok: number }>('/api/v1/mail/bulk', {
                method: 'POST',
                body: JSON.stringify(pending.payload),
              })
              toast.success(t('mail.bulkResult', { ok: data.ok, total: data.total }))
            } else {
              const { id } = pending.payload as { id: number }
              await api(`/api/v1/mail/${id}`, { method: 'DELETE', body: JSON.stringify({ confirm: true }) })
              toast.success(t('common.ok'))
              void loadMails()
            }
            setPending(null)
          } catch (err) {
            toast.error(errorMessage(err, t))
          }
        }}
      />
    </div>
  )
}
