import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, errorMessage, hasMinRole } from '../api/client'
import { ConfirmDanger } from '../components/ConfirmDanger'
import { DataTable, Select, toast, type Column } from '../ui'

type Broadcast = { id: number; text: string; weight: number }

const MOTD_LOCALES = [
  { value: 'zhCN', label: 'zhCN（简体中文）' },
  { value: 'enUS', label: 'enUS（English）' },
  { value: 'zhTW', label: 'zhTW（繁體中文）' },
  { value: 'koKR', label: 'koKR' },
  { value: 'frFR', label: 'frFR' },
  { value: 'deDE', label: 'deDE' },
  { value: 'esES', label: 'esES' },
  { value: 'esMX', label: 'esMX' },
  { value: 'ruRU', label: 'ruRU' },
]

export function AnnouncementsPage() {
  const { t, i18n } = useTranslation()
  const [motdByLocale, setMotdByLocale] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [pendingMotd, setPendingMotd] = useState<{ message: string; locale: string } | null>(null)
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([])
  const [broadcastLoading, setBroadcastLoading] = useState(false)
  const [pending, setPending] = useState<{ title: string; description: string; run: () => Promise<void> } | null>(
    null,
  )

  const defaultMotdLocale = i18n.language.startsWith('zh') ? 'zhCN' : 'enUS'

  const [announceType, setAnnounceType] = useState('announce')
  const [announceMessage, setAnnounceMessage] = useState('')
  const [motdLocale, setMotdLocale] = useState(defaultMotdLocale)
  const [motdMessage, setMotdMessage] = useState('')
  const [bcText, setBcText] = useState('')
  const [bcWeight, setBcWeight] = useState('1')
  const [bcRealmId, setBcRealmId] = useState('-1')

  const localeRef = useRef(motdLocale)
  useEffect(() => {
    localeRef.current = motdLocale
  }, [motdLocale])

  const applyMotdLocale = useCallback((locale: string, byLocale: Record<string, string>) => {
    setMotdLocale(locale)
    setMotdMessage(byLocale[locale] ?? '')
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api<{ motd: string; by_locale?: Record<string, string> }>('/api/v1/motd')
      const byLocale = data.by_locale ?? {}
      setMotdByLocale(byLocale)
      const locale = localeRef.current || defaultMotdLocale
      applyMotdLocale(locale, byLocale)
    } catch (err) {
      toast.error(errorMessage(err, t))
    } finally {
      setLoading(false)
    }
  }, [applyMotdLocale, defaultMotdLocale, t])

  const loadBroadcast = useCallback(async () => {
    setBroadcastLoading(true)
    try {
      const data = await api<{ items: Broadcast[] }>('/api/v1/autobroadcast')
      setBroadcasts(data.items)
    } catch {
      setBroadcasts([])
    } finally {
      setBroadcastLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    void loadBroadcast()
  }, [load, loadBroadcast])

  const columns: Column<Broadcast>[] = [
    { key: 'id', title: 'ID', dataIndex: 'id', width: 70 },
    { key: 'text', title: t('announcements.message'), dataIndex: 'text' },
    { key: 'weight', title: t('announcements.weight'), dataIndex: 'weight', width: 90 },
    {
      key: 'actions',
      title: t('common.actions'),
      width: 100,
      render: (_v, row) =>
        hasMinRole('gm') ? (
          <button
            type="button"
            className="btn btn-error btn-xs"
            onClick={() =>
              setPending({
                title: t('announcements.deleteBroadcast'),
                description: t('announcements.deleteBroadcastConfirm', { id: row.id }),
                run: async () => {
                  await api(`/api/v1/autobroadcast/${row.id}`, {
                    method: 'DELETE',
                    body: JSON.stringify({ confirm: true }),
                  })
                  await loadBroadcast()
                },
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
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h1 className="text-2xl font-semibold m-0">{t('pages.announcements.title')}</h1>
        <button
          type="button"
          className="btn btn-sm"
          disabled={loading}
          onClick={() => {
            void load()
            void loadBroadcast()
          }}
        >
          {loading && <span className="loading loading-spinner loading-xs" />}
          {t('common.refresh')}
        </button>
      </div>

      {hasMinRole('gm') && (
        <div className="flex flex-col gap-8 w-full max-w-[640px]">
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault()
              try {
                await api('/api/v1/announce', {
                  method: 'POST',
                  body: JSON.stringify({ type: announceType, message: announceMessage }),
                })
                toast.success(t('common.ok'))
                setAnnounceMessage('')
              } catch (err) {
                toast.error(errorMessage(err, t))
              }
            }}
          >
            <h2 className="text-base font-semibold m-0">{t('announcements.send')}</h2>
            <label className="form-control w-full">
              <span className="label-text mb-1">{t('announcements.type')}</span>
              <Select
                value={announceType}
                onChange={(v) => setAnnounceType(v ?? 'announce')}
                options={[
                  { value: 'announce', label: t('announcements.typeAnnounce') },
                  { value: 'notify', label: t('announcements.typeNotify') },
                ]}
              />
            </label>
            <label className="form-control w-full">
              <span className="label-text mb-1">{t('announcements.message')}</span>
              <textarea
                className="textarea textarea-bordered w-full"
                rows={3}
                maxLength={255}
                required
                value={announceMessage}
                onChange={(e) => setAnnounceMessage(e.target.value)}
              />
            </label>
            <div>
              <button type="submit" className="btn btn-primary btn-sm">
                {t('announcements.send')}
              </button>
            </div>
          </form>

          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              setPendingMotd({
                message: motdMessage ?? '',
                locale: motdLocale || defaultMotdLocale,
              })
            }}
          >
            <h2 className="text-base font-semibold m-0">{t('announcements.setMotd')}</h2>
            <label className="form-control w-full">
              <span className="label-text mb-1">{t('announcements.motdLocale')}</span>
              <Select
                value={motdLocale}
                onChange={(v) => applyMotdLocale(v ?? defaultMotdLocale, motdByLocale)}
                options={MOTD_LOCALES}
              />
              <span className="label-text-alt text-base-content/60 mt-1">{t('announcements.motdLocaleHint')}</span>
            </label>
            <label className="form-control w-full">
              <span className="label-text mb-1">{t('announcements.motdLabel')}</span>
              <textarea
                className="textarea textarea-bordered w-full"
                rows={3}
                maxLength={255}
                required
                placeholder={t('announcements.motdEmpty')}
                value={motdMessage}
                onChange={(e) => setMotdMessage(e.target.value)}
              />
            </label>
            <div>
              <button type="submit" className="btn btn-sm">
                {t('announcements.setMotd')}
              </button>
            </div>
          </form>
        </div>
      )}

      <ConfirmDanger
        open={pendingMotd !== null}
        description={t('announcements.motdConfirm', {
          locale: pendingMotd?.locale ?? '',
        })}
        onCancel={() => setPendingMotd(null)}
        onConfirm={async () => {
          if (!pendingMotd) return
          try {
            await api('/api/v1/motd', {
              method: 'POST',
              body: JSON.stringify({
                message: pendingMotd.message,
                locale: pendingMotd.locale,
                confirm: true,
              }),
            })
            toast.success(t('common.ok'))
            setPendingMotd(null)
            void load()
          } catch (err) {
            toast.error(errorMessage(err, t))
          }
        }}
      />

      <h2 className="text-base font-semibold mt-6 mb-3">{t('announcements.autobroadcast')}</h2>

      {hasMinRole('gm') && (
        <form
          className="flex flex-wrap items-start gap-2 mb-4"
          onSubmit={(e) => {
            e.preventDefault()
            const values = {
              text: bcText,
              weight: Number(bcWeight),
              realmid: bcRealmId === '' ? undefined : Number(bcRealmId),
            }
            setPending({
              title: t('announcements.createBroadcast'),
              description: t('announcements.createBroadcastConfirm'),
              run: async () => {
                await api('/api/v1/autobroadcast', {
                  method: 'POST',
                  body: JSON.stringify({ ...values, confirm: true }),
                })
                setBcText('')
                await loadBroadcast()
              },
            })
          }}
        >
          <textarea
            className="textarea textarea-bordered w-[280px]"
            rows={1}
            required
            placeholder={t('announcements.message')}
            value={bcText}
            onChange={(e) => setBcText(e.target.value)}
          />
          <input
            type="number"
            min={1}
            required
            className="input input-bordered w-32"
            placeholder={t('announcements.weight')}
            value={bcWeight}
            onChange={(e) => setBcWeight(e.target.value)}
          />
          <input
            type="number"
            className="input input-bordered w-32"
            placeholder={t('announcements.realmId')}
            value={bcRealmId}
            onChange={(e) => setBcRealmId(e.target.value)}
          />
          <button type="submit" className="btn btn-primary">
            {t('announcements.createBroadcast')}
          </button>
        </form>
      )}

      <DataTable rowKey="id" loading={broadcastLoading} dataSource={broadcasts} columns={columns} />

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
