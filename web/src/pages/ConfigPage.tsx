import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, errorMessage } from '../api/client'
import { ConfirmDanger } from '../components/ConfirmDanger'
import { toast } from '../ui'

type ConfFile = {
  id: string
  path: string
  available: boolean
  size?: number
  mod_time?: string
  error?: string
}

export function ConfigPage() {
  const { t } = useTranslation()
  const [files, setFiles] = useState<ConfFile[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [path, setPath] = useState('')
  const [loading, setLoading] = useState(false)
  const [pendingSave, setPendingSave] = useState(false)
  const [pendingBackup, setPendingBackup] = useState(false)

  const loadFiles = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api<{ items: ConfFile[] }>('/api/v1/config/files')
      setFiles(data.items)
    } catch (err) {
      toast.error(errorMessage(err, t))
    } finally {
      setLoading(false)
    }
  }, [t])

  const loadFile = useCallback(
    async (id: string) => {
      setLoading(true)
      try {
        const data = await api<{ id: string; path: string; content: string }>(
          `/api/v1/config/files/${encodeURIComponent(id)}`,
        )
        setSelected(id)
        setContent(data.content)
        setPath(data.path)
      } catch (err) {
        toast.error(errorMessage(err, t))
      } finally {
        setLoading(false)
      }
    },
    [t],
  )

  useEffect(() => {
    void loadFiles()
  }, [loadFiles])

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h1 className="text-2xl font-semibold m-0">{t('pages.config.title')}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-sm" onClick={() => void loadFiles()}>
            {t('common.refresh')}
          </button>
          <button type="button" className="btn btn-sm btn-error" onClick={() => setPendingBackup(true)}>
            {t('config.backup')}
          </button>
        </div>
      </div>

      <h2 className="text-base font-semibold mb-2">{t('config.files')}</h2>
      <div className="relative mb-4 max-w-[640px]">
        {loading && !selected && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-base-100/60">
            <span className="loading loading-spinner loading-md" />
          </div>
        )}
        <ul className="rounded-box border border-base-300 divide-y divide-base-300">
          {files.length === 0 ? (
            <li className="px-4 py-6 text-center text-base-content/60">—</li>
          ) : (
            files.map((item) => (
              <li key={item.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{item.id}</div>
                  <div className="text-sm text-base-content/60 truncate">
                    {item.available
                      ? `${item.path}${item.size != null ? ` · ${item.size} B` : ''}`
                      : item.error || t('config.unavailable')}
                  </div>
                </div>
                <button
                  type="button"
                  className={`btn btn-xs ${selected === item.id ? 'btn-primary' : ''}`}
                  disabled={!item.available}
                  onClick={() => void loadFile(item.id)}
                >
                  {t('config.open')}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>

      {selected && (
        <div className="max-w-[960px] flex flex-col gap-2">
          <span className="text-sm text-base-content/60">{path}</span>
          <label className="form-control w-full">
            <span className="label-text mb-1">{t('config.content')}</span>
            <textarea
              className="textarea textarea-bordered w-full font-mono text-xs leading-5"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={24}
            />
          </label>
          <div>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setPendingSave(true)}>
              {t('config.save')}
            </button>
          </div>
        </div>
      )}

      <ConfirmDanger
        open={pendingSave}
        title={t('config.save')}
        description={t('config.saveConfirm', { id: selected ?? '' })}
        onCancel={() => setPendingSave(false)}
        onConfirm={async () => {
          if (!selected) return
          try {
            await api(`/api/v1/config/files/${encodeURIComponent(selected)}`, {
              method: 'PUT',
              body: JSON.stringify({ content, confirm: true }),
            })
            toast.success(t('common.ok'))
            setPendingSave(false)
            void loadFiles()
          } catch (err) {
            toast.error(errorMessage(err, t))
          }
        }}
      />

      <ConfirmDanger
        open={pendingBackup}
        title={t('config.backup')}
        description={t('config.backupConfirm')}
        onCancel={() => setPendingBackup(false)}
        onConfirm={async () => {
          try {
            await api('/api/v1/backup', {
              method: 'POST',
              body: JSON.stringify({ confirm: true }),
            })
            toast.success(t('common.ok'))
            setPendingBackup(false)
          } catch (err) {
            toast.error(errorMessage(err, t))
          }
        }}
      />
    </div>
  )
}
