import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, errorMessage, getTargetId, getToken, hasMinRole } from '../api/client'
import { ConfirmDanger } from '../components/ConfirmDanger'
import { DataTable, Modal, Tabs, toast, type Column } from '../ui'

type ConfFile = {
  id: string
  path: string
  available: boolean
  size?: number
  mod_time?: string
  error?: string
  label?: string
}

type ConfFileBackup = {
  name: string
  path: string
  size?: number
  mod_time?: string
}

type BackupSet = {
  stamp: string
  target_id: string
  created_at?: string
  dbs: string[]
  files: { db: string; name: string; size: number }[]
}

type CheckpointStep = {
  id: string
  label: string
  status: 'running' | 'ok' | 'fail' | 'skip'
  detail?: string
}

type CheckpointMeta = {
  id: string
  target_id: string
  created_at: string
  reason?: string
  deploy: string
  world_image?: string
  world_image_checkpoint_tag?: string
  image_tag_error?: string
  sql_files?: string[]
  steps?: CheckpointStep[]
  warnings?: string[]
  note?: string
}

export function ConfigPage() {
  const { t, i18n } = useTranslation()
  const zh = i18n.language.startsWith('zh')
  const [tab, setTab] = useState('files')

  const [files, setFiles] = useState<ConfFile[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [path, setPath] = useState('')
  const [loading, setLoading] = useState(false)
  const [pendingSave, setPendingSave] = useState(false)
  const [confBackups, setConfBackups] = useState<ConfFileBackup[]>([])
  const [pendingConfRestore, setPendingConfRestore] = useState<ConfFileBackup | null>(null)

  const [backups, setBackups] = useState<BackupSet[]>([])
  const [backupDir, setBackupDir] = useState('')
  const [pendingBackup, setPendingBackup] = useState(false)
  const [backupBusy, setBackupBusy] = useState(false)
  const [restoreTarget, setRestoreTarget] = useState<BackupSet | null>(null)
  const [restorePhrase, setRestorePhrase] = useState('')
  const [restoreError, setRestoreError] = useState('')
  const [restoreBusy, setRestoreBusy] = useState(false)

  const [checkpoints, setCheckpoints] = useState<CheckpointMeta[]>([])
  const [ckptKeep, setCkptKeep] = useState(5)
  const [pendingCkpt, setPendingCkpt] = useState(false)
  const [ckptBusy, setCkptBusy] = useState(false)
  const [ckptReason, setCkptReason] = useState('')
  const [ckptSteps, setCkptSteps] = useState<CheckpointStep[]>([])
  const [ckptStreamError, setCkptStreamError] = useState('')
  const [rollbackTarget, setRollbackTarget] = useState<CheckpointMeta | null>(null)
  const [rollbackPhrase, setRollbackPhrase] = useState('')
  const [rollbackError, setRollbackError] = useState('')
  const [rollbackBusy, setRollbackBusy] = useState(false)
  const [pendingDelBackup, setPendingDelBackup] = useState<BackupSet | null>(null)
  const [pendingDelCkpt, setPendingDelCkpt] = useState<CheckpointMeta | null>(null)

  const loadFiles = useCallback(async () => {
    const data = await api<{ items: ConfFile[] }>('/api/v1/config/files')
    setFiles(data.items)
  }, [])

  const loadBackups = useCallback(async () => {
    if (!hasMinRole('superadmin')) return
    const data = await api<{ dir: string; items: BackupSet[] }>('/api/v1/backup')
    setBackupDir(data.dir || '')
    setBackups(data.items || [])
  }, [])

  const loadCheckpoints = useCallback(async () => {
    if (!hasMinRole('superadmin')) return
    const data = await api<{ items: CheckpointMeta[]; keep?: number }>('/api/v1/modules/checkpoints')
    setCheckpoints(data.items || [])
    if (data.keep) setCkptKeep(data.keep)
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      await Promise.all([loadFiles(), loadBackups(), loadCheckpoints()])
    } catch (err) {
      toast.error(errorMessage(err, t))
    } finally {
      setLoading(false)
    }
  }, [loadFiles, loadBackups, loadCheckpoints, t])

  const loadConfBackups = useCallback(async (id: string) => {
    const data = await api<{ items: ConfFileBackup[] }>(
      `/api/v1/config/files/${encodeURIComponent(id)}/backups`,
    )
    setConfBackups(data.items || [])
  }, [])

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
        await loadConfBackups(id)
      } catch (err) {
        toast.error(errorMessage(err, t))
      } finally {
        setLoading(false)
      }
    },
    [t, loadConfBackups],
  )

  useEffect(() => {
    void refresh()
  }, [refresh])

  const backupFile = useCallback(
    async (id: string) => {
      try {
        await api(`/api/v1/config/files/${encodeURIComponent(id)}/backup`, {
          method: 'POST',
          body: JSON.stringify({ confirm: true }),
        })
        toast.success(t('config.fileBackupOk'))
        if (selected === id) await loadConfBackups(id)
      } catch (err) {
        toast.error(errorMessage(err, t))
      }
    },
    [t, selected, loadConfBackups],
  )

  const fileColumns: Column<ConfFile>[] = useMemo(
    () => [
      {
        key: 'label',
        title: t('config.fileName'),
        sorter: true,
        sortValue: (r) => r.label || r.id,
        render: (_v, r) => <span className="font-medium">{r.label || r.id}</span>,
      },
      {
        key: 'path',
        title: t('config.filePath'),
        render: (_v, r) => (
          <span className="font-mono text-xs break-all">{r.path || '—'}</span>
        ),
      },
      {
        key: 'size',
        title: t('config.fileSize'),
        sorter: true,
        sortValue: (r) => r.size ?? -1,
        render: (_v, r) =>
          r.available && r.size != null ? (
            <span className="text-sm tabular-nums">{r.size.toLocaleString()} B</span>
          ) : (
            <span className="text-warning text-xs">{r.error || t('config.unavailable')}</span>
          ),
      },
      {
        key: 'mod_time',
        title: t('config.fileModTime'),
        sorter: true,
        sortValue: (r) => r.mod_time || '',
        render: (_v, r) => (
          <span className="text-sm tabular-nums whitespace-nowrap">
            {r.mod_time ? new Date(r.mod_time).toLocaleString(zh ? 'zh-CN' : 'en-US') : '—'}
          </span>
        ),
      },
      {
        key: 'actions',
        title: t('common.actions'),
        render: (_v, r) => (
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              className="btn btn-xs"
              disabled={!r.available && r.id !== 'compose_override'}
              onClick={() => void loadFile(r.id)}
            >
              {t('config.open')}
            </button>
            <button
              type="button"
              className="btn btn-xs"
              disabled={!r.available}
              onClick={() => void backupFile(r.id)}
            >
              {t('config.fileBackup')}
            </button>
          </div>
        ),
      },
    ],
    [t, zh, loadFile, backupFile],
  )

  const confBackupColumns: Column<ConfFileBackup>[] = useMemo(
    () => [
      {
        key: 'name',
        title: t('config.fileBackupName'),
        sorter: true,
        sortValue: (r) => r.name,
        render: (_v, r) => <span className="font-mono text-xs break-all">{r.name}</span>,
      },
      {
        key: 'mod_time',
        title: t('config.backupTime'),
        sorter: true,
        sortValue: (r) => r.mod_time || '',
        render: (_v, r) => (
          <span className="text-sm tabular-nums whitespace-nowrap">
            {r.mod_time ? new Date(r.mod_time).toLocaleString(zh ? 'zh-CN' : 'en-US') : '—'}
          </span>
        ),
      },
      {
        key: 'size',
        title: t('config.fileSize'),
        sorter: true,
        sortValue: (r) => r.size ?? 0,
        render: (_v, r) =>
          r.size != null ? (
            <span className="text-sm tabular-nums">{r.size.toLocaleString()} B</span>
          ) : (
            '—'
          ),
      },
      {
        key: 'actions',
        title: t('common.actions'),
        render: (_v, r) => (
          <button type="button" className="btn btn-xs btn-warning" onClick={() => setPendingConfRestore(r)}>
            {t('config.fileRestore')}
          </button>
        ),
      },
    ],
    [t, zh],
  )

  const backupColumns: Column<BackupSet>[] = useMemo(
    () => [
      {
        key: 'stamp',
        title: t('config.backupStamp'),
        sorter: true,
        sortValue: (r) => r.stamp,
        render: (_v, r) => <span className="font-mono text-xs">{r.stamp}</span>,
      },
      {
        key: 'created_at',
        title: t('config.backupTime'),
        sorter: true,
        sortValue: (r) => r.created_at || r.stamp,
        render: (_v, r) => (
          <span className="text-sm tabular-nums whitespace-nowrap">
            {r.created_at
              ? new Date(r.created_at).toLocaleString(zh ? 'zh-CN' : 'en-US')
              : r.stamp}
          </span>
        ),
      },
      {
        key: 'dbs',
        title: t('config.backupDBs'),
        render: (_v, r) => (r.dbs?.length ? r.dbs.join(', ') : '—'),
      },
      {
        key: 'actions',
        title: t('common.actions'),
        render: (_v, r) => (
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              className="btn btn-xs btn-warning"
              onClick={() => {
                setRestorePhrase('')
                setRestoreError('')
                setRestoreTarget(r)
              }}
            >
              {t('config.backupRestore')}
            </button>
            <button type="button" className="btn btn-xs btn-ghost text-error" onClick={() => setPendingDelBackup(r)}>
              {t('common.delete')}
            </button>
          </div>
        ),
      },
    ],
    [t, zh],
  )

  const checkpointColumns: Column<CheckpointMeta>[] = useMemo(
    () => [
      {
        key: 'id',
        title: 'ID',
        sorter: true,
        sortValue: (r) => r.id,
        render: (_v, r) => <span className="font-mono text-xs">{r.id}</span>,
      },
      {
        key: 'created_at',
        title: t('config.ckptTime'),
        sorter: true,
        sortValue: (r) => r.created_at || '',
        render: (_v, r) => (
          <span className="text-sm tabular-nums whitespace-nowrap">
            {r.created_at ? new Date(r.created_at).toLocaleString(zh ? 'zh-CN' : 'en-US') : '—'}
          </span>
        ),
      },
      {
        key: 'reason',
        title: t('config.ckptReason'),
        render: (_v, r) => r.reason || '—',
      },
      {
        key: 'tag',
        title: t('config.ckptImageTag'),
        render: (_v, r) =>
          r.world_image_checkpoint_tag ? (
            <span className="font-mono text-xs">{r.world_image_checkpoint_tag}</span>
          ) : (
            <span className="text-warning text-xs">{r.image_tag_error || '—'}</span>
          ),
      },
      {
        key: 'steps',
        title: t('config.ckptSteps'),
        render: (_v, r) => {
          const steps = r.steps || []
          if (!steps.length) return '—'
          const ok = steps.filter((s) => s.status === 'ok').length
          const fail = steps.filter((s) => s.status === 'fail').length
          const skip = steps.filter((s) => s.status === 'skip').length
          return (
            <span className="text-xs whitespace-nowrap">
              <span className="text-success">{ok}✓</span>
              {fail > 0 && <span className="text-error ml-1">{fail}✗</span>}
              {skip > 0 && <span className="opacity-50 ml-1">{skip}–</span>}
            </span>
          )
        },
      },
      {
        key: 'sql',
        title: t('config.ckptSQL'),
        render: (_v, r) => (r.sql_files?.length ? r.sql_files.join(', ') : '—'),
      },
      {
        key: 'actions',
        title: t('common.actions'),
        render: (_v, r) => (
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              className="btn btn-xs btn-error"
              onClick={() => {
                setRollbackPhrase('')
                setRollbackError('')
                setRollbackTarget(r)
              }}
            >
              {t('config.ckptRollback')}
            </button>
            <button type="button" className="btn btn-xs btn-ghost text-error" onClick={() => setPendingDelCkpt(r)}>
              {t('common.delete')}
            </button>
          </div>
        ),
      },
    ],
    [t, zh],
  )

  const coreFiles = files
  const selectedFile = selected ? files.find((f) => f.id === selected) : undefined

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div>
          <h1 className="text-2xl font-semibold m-0">{t('pages.config.title')}</h1>
          <p className="text-sm text-base-content/60 m-0 mt-1">{t('config.subtitle')}</p>
        </div>
        <button type="button" className="btn btn-sm" onClick={() => void refresh()} disabled={loading}>
          {loading ? <span className="loading loading-spinner loading-xs" /> : null}
          {t('common.refresh')}
        </button>
      </div>

      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: 'files',
            label: t('config.tabFiles'),
            children: (
              <div>
                <DataTable
                  columns={fileColumns}
                  dataSource={coreFiles}
                  rowKey={(r) => r.id}
                  loading={loading && !selected}
                />
              </div>
            ),
          },
          {
            key: 'backup',
            label: t('config.tabBackup'),
            children: (
              <div className="space-y-4">
                <div className="rounded-box border border-base-300 p-4 max-w-3xl">
                  <h3 className="font-medium m-0 mb-1">{t('config.backupTitle')}</h3>
                  <p className="text-sm text-base-content/60 m-0 mb-3">{t('config.backupHint')}</p>
                  {backupDir && (
                    <p className="text-xs text-base-content/45 m-0 mb-3 font-mono">{backupDir}</p>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    disabled={backupBusy}
                    onClick={() => setPendingBackup(true)}
                  >
                    {backupBusy && <span className="loading loading-spinner loading-xs" />}
                    {t('config.backup')}
                  </button>
                </div>
                <DataTable
                  columns={backupColumns}
                  dataSource={backups}
                  rowKey={(r) => r.stamp}
                  defaultSortKey="stamp"
                  defaultSortDir="desc"
                />
              </div>
            ),
          },
          {
            key: 'checkpoints',
            label: t('config.tabCheckpoints'),
            children: (
              <div className="space-y-4">
                <div className="rounded-box border border-base-300 p-4 max-w-3xl">
                  <h3 className="font-medium m-0 mb-1">{t('config.ckptTitle')}</h3>
                  <p className="text-sm text-base-content/60 m-0 mb-2">{t('config.ckptHint')}</p>
                  <p className="text-sm text-base-content/60 m-0 mb-3">
                    {t('config.ckptKeepHint', { keep: ckptKeep })}
                  </p>
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    disabled={ckptBusy}
                    onClick={() => setPendingCkpt(true)}
                  >
                    {ckptBusy && <span className="loading loading-spinner loading-xs" />}
                    {t('config.ckptCreate')}
                  </button>
                </div>
                <DataTable
                  columns={checkpointColumns}
                  dataSource={checkpoints}
                  rowKey={(r) => r.id}
                  defaultSortKey="created_at"
                  defaultSortDir="desc"
                />
              </div>
            ),
          },
        ]}
      />

      <Modal
        open={!!selected}
        title={selectedFile?.label || selected || t('config.open')}
        className="max-w-5xl max-h-[min(92vh,900px)]"
        okText={t('config.save')}
        cancelText={t('confirm.cancel')}
        confirmLoading={loading}
        onClose={() => {
          if (pendingSave || pendingConfRestore) return
          setSelected(null)
          setContent('')
          setPath('')
          setConfBackups([])
        }}
        onOk={() => setPendingSave(true)}
      >
        <div className="space-y-3">
          <p className="m-0 text-xs font-mono text-base-content/60 break-all">{path}</p>
          {loading ? (
            <div className="flex justify-center py-12">
              <span className="loading loading-spinner loading-md" />
            </div>
          ) : (
            <>
              <label className="form-control w-full">
                <span className="label-text mb-1">{t('config.content')}</span>
                <textarea
                  className="textarea textarea-bordered w-full font-mono text-xs leading-5 min-h-[320px]"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={18}
                />
              </label>
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                  <h4 className="text-sm font-medium m-0">{t('config.fileBackups')}</h4>
                  <button
                    type="button"
                    className="btn btn-xs"
                    disabled={!selected}
                    onClick={() => selected && void backupFile(selected)}
                  >
                    {t('config.fileBackup')}
                  </button>
                </div>
                <p className="text-xs text-base-content/50 m-0 mb-2">{t('config.fileBackupsHint')}</p>
                <DataTable
                  columns={confBackupColumns}
                  dataSource={confBackups}
                  rowKey={(r) => r.name}
                  defaultSortKey="name"
                  defaultSortDir="desc"
                />
              </div>
            </>
          )}
        </div>
      </Modal>

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
            void loadConfBackups(selected)
          } catch (err) {
            toast.error(errorMessage(err, t))
          }
        }}
      />

      <ConfirmDanger
        open={!!pendingConfRestore}
        title={t('config.fileRestore')}
        description={t('config.fileRestoreConfirm', { name: pendingConfRestore?.name ?? '' })}
        onCancel={() => setPendingConfRestore(null)}
        onConfirm={async () => {
          if (!selected || !pendingConfRestore) return
          try {
            const data = await api<{ content: string }>(
              `/api/v1/config/files/${encodeURIComponent(selected)}/restore`,
              {
                method: 'POST',
                body: JSON.stringify({ backup: pendingConfRestore.name, confirm: true }),
              },
            )
            setContent(data.content ?? '')
            setPendingConfRestore(null)
            toast.success(t('common.ok'))
            void loadConfBackups(selected)
            void loadFiles()
          } catch (err) {
            toast.error(errorMessage(err, t))
          }
        }}
      />

      <ConfirmDanger
        open={pendingBackup}
        title={t('config.backup')}
        loading={backupBusy}
        description={t('config.backupConfirm')}
        onCancel={() => {
          if (backupBusy) return
          setPendingBackup(false)
        }}
        onConfirm={async () => {
          setBackupBusy(true)
          try {
            await api('/api/v1/backup', {
              method: 'POST',
              body: JSON.stringify({ confirm: true }),
            })
            toast.success(t('common.ok'))
            setPendingBackup(false)
            await loadBackups()
          } catch (err) {
            toast.error(errorMessage(err, t))
          } finally {
            setBackupBusy(false)
          }
        }}
      />

      <Modal
        open={!!restoreTarget}
        title={t('config.backupRestore')}
        okDanger
        confirmLoading={restoreBusy}
        onClose={() => {
          if (restoreBusy) return
          setRestoreTarget(null)
        }}
        onOk={async () => {
          if (!restoreTarget) return
          if (restorePhrase.trim() !== restoreTarget.stamp) {
            setRestoreError(t('config.backupPhraseMismatch'))
            return
          }
          setRestoreError('')
          setRestoreBusy(true)
          try {
            await api('/api/v1/backup/restore', {
              method: 'POST',
              body: JSON.stringify({
                confirm: true,
                stamp: restoreTarget.stamp,
                confirm_phrase: restorePhrase.trim(),
              }),
            })
            setRestoreTarget(null)
            toast.success(t('common.ok'))
          } catch (err) {
            toast.error(errorMessage(err, t))
          } finally {
            setRestoreBusy(false)
          }
        }}
      >
        {restoreTarget && (
          <div className="space-y-3">
            <p className="m-0 text-sm text-error">{t('config.backupRestoreWarn')}</p>
            <p className="m-0 text-sm">{t('config.backupRestoreHint', { stamp: restoreTarget.stamp })}</p>
            <label className="form-control w-full">
              <span className="label-text text-xs">{t('config.backupPhrase')}</span>
              <input
                className="input input-bordered input-sm w-full font-mono"
                value={restorePhrase}
                onChange={(e) => setRestorePhrase(e.target.value)}
                placeholder={restoreTarget.stamp}
                autoComplete="off"
              />
              {restoreError && <span className="text-error text-xs mt-1">{restoreError}</span>}
            </label>
          </div>
        )}
      </Modal>

      <Modal
        open={pendingCkpt}
        title={t('config.ckptCreate')}
        okDanger={!ckptBusy && ckptSteps.every((s) => s.status !== 'fail')}
        confirmLoading={ckptBusy}
        okText={
          ckptBusy
            ? t('config.ckptCreating')
            : ckptSteps.some((s) => s.status === 'fail' || s.status === 'ok')
              ? t('common.ok')
              : t('confirm.ok')
        }
        onClose={() => {
          if (ckptBusy) return
          setPendingCkpt(false)
          setCkptSteps([])
          setCkptStreamError('')
        }}
        onOk={async () => {
          if (ckptBusy) return
          // 创建结束后（含部分失败）再点按钮 = 关闭
          if (ckptSteps.some((s) => s.status === 'ok' || s.status === 'fail' || s.status === 'skip')) {
            setPendingCkpt(false)
            setCkptReason('')
            setCkptSteps([])
            setCkptStreamError('')
            return
          }
          setCkptBusy(true)
          setCkptSteps([])
          setCkptStreamError('')
          try {
            const headers = new Headers({
              'Content-Type': 'application/json',
              Accept: 'text/event-stream',
            })
            const token = getToken()
            if (token) headers.set('Authorization', `Bearer ${token}`)
            const target = getTargetId()
            if (target) headers.set('X-Target-Id', target)

            const res = await fetch('/api/v1/modules/checkpoints/stream', {
              method: 'POST',
              headers,
              body: JSON.stringify({ confirm: true, reason: ckptReason.trim() || undefined }),
            })
            if (!res.ok || !res.body) {
              let msg = res.statusText
              try {
                const body = (await res.json()) as { error?: { message?: string; code?: string } }
                msg = body.error?.message || msg
              } catch {
                /* ignore */
              }
              throw new Error(msg)
            }

            const reader = res.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ''
            let doneMeta: CheckpointMeta | null = null
            let streamErr = ''

            const upsertStep = (step: CheckpointStep) => {
              setCkptSteps((prev) => {
                const idx = prev.findIndex((s) => s.id === step.id)
                if (idx < 0) return [...prev, step]
                const next = prev.slice()
                next[idx] = step
                return next
              })
            }

            while (true) {
              const { value, done } = await reader.read()
              if (done) break
              buffer += decoder.decode(value, { stream: true })
              const chunks = buffer.split('\n\n')
              buffer = chunks.pop() || ''
              for (const chunk of chunks) {
                const lines = chunk.split('\n')
                let event = 'message'
                const dataLines: string[] = []
                for (const line of lines) {
                  if (line.startsWith('event:')) event = line.slice(6).trim()
                  else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
                }
                if (!dataLines.length) continue
                const raw = dataLines.join('\n')
                try {
                  const data = JSON.parse(raw) as CheckpointStep & CheckpointMeta & { message?: string }
                  if (event === 'step') {
                    upsertStep({
                      id: data.id,
                      label: data.label,
                      status: data.status,
                      detail: data.detail,
                    })
                  } else if (event === 'done') {
                    doneMeta = data as CheckpointMeta
                    if (data.steps?.length) setCkptSteps(data.steps)
                  } else if (event === 'error') {
                    streamErr = data.message || t('errors.checkpoint_failed')
                    setCkptStreamError(streamErr)
                  }
                } catch {
                  /* ignore partial */
                }
              }
            }

            if (streamErr) {
              toast.error(streamErr)
              return
            }
            if (!doneMeta) {
              throw new Error(t('errors.checkpoint_failed'))
            }
            const finalSteps = doneMeta.steps?.length ? doneMeta.steps : ckptSteps
            if (doneMeta.steps?.length) setCkptSteps(doneMeta.steps)
            const fails = finalSteps.filter((s) => s.status === 'fail')
            await loadCheckpoints()
            if (fails.length) {
              toast.info(t('config.ckptPartialOk'))
              // 保留弹窗与步骤列表，便于核对 Docker/文件等失败原因
              return
            }
            toast.success(t('common.success'))
            setPendingCkpt(false)
            setCkptReason('')
            setCkptSteps([])
          } catch (err) {
            toast.error(errorMessage(err, t))
            setCkptStreamError(errorMessage(err, t))
          } finally {
            setCkptBusy(false)
          }
        }}
      >
        <div className="space-y-3">
          <p className="m-0 text-sm">{t('config.ckptCreateHint')}</p>
          {!ckptBusy && ckptSteps.length === 0 && (
            <label className="form-control w-full">
              <span className="label-text text-xs">{t('config.ckptReason')}</span>
              <input
                className="input input-bordered input-sm w-full"
                value={ckptReason}
                onChange={(e) => setCkptReason(e.target.value)}
                placeholder={t('config.ckptReasonPlaceholder')}
              />
            </label>
          )}
          {(ckptBusy || ckptSteps.length > 0) && (
            <ul className="m-0 list-none space-y-1.5 max-h-64 overflow-y-auto border border-base-300 rounded-box p-3">
              {ckptSteps.map((s) => (
                <li key={s.id} className="flex items-start gap-2 text-sm">
                  <span className="shrink-0 w-4 text-center mt-0.5">
                    {s.status === 'running' && <span className="loading loading-spinner loading-xs" />}
                    {s.status === 'ok' && <span className="text-success">✓</span>}
                    {s.status === 'fail' && <span className="text-error">✗</span>}
                    {s.status === 'skip' && <span className="opacity-40">–</span>}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{s.label}</span>
                    {s.detail && (
                      <span className={`block text-xs mt-0.5 break-all ${s.status === 'fail' ? 'text-error' : 'opacity-60'}`}>
                        {s.detail}
                      </span>
                    )}
                  </span>
                </li>
              ))}
              {ckptBusy && ckptSteps.length === 0 && (
                <li className="text-sm opacity-60 flex items-center gap-2">
                  <span className="loading loading-spinner loading-xs" />
                  {t('config.ckptCreating')}
                </li>
              )}
            </ul>
          )}
          {!ckptBusy && ckptSteps.some((s) => s.status === 'fail') && (
            <p className="m-0 text-sm text-warning">{t('config.ckptPartialOk')}</p>
          )}
          {ckptStreamError && <p className="m-0 text-sm text-error">{ckptStreamError}</p>}
        </div>
      </Modal>

      <Modal
        open={!!rollbackTarget}
        title={t('config.ckptRollback')}
        okDanger
        confirmLoading={rollbackBusy}
        onClose={() => {
          if (rollbackBusy) return
          setRollbackTarget(null)
        }}
        onOk={async () => {
          if (!rollbackTarget) return
          if (rollbackPhrase.trim() !== rollbackTarget.id) {
            setRollbackError(t('config.ckptPhraseMismatch'))
            return
          }
          setRollbackError('')
          setRollbackBusy(true)
          try {
            await api(`/api/v1/modules/checkpoints/${encodeURIComponent(rollbackTarget.id)}/rollback`, {
              method: 'POST',
              body: JSON.stringify({ confirm: true, confirm_phrase: rollbackPhrase.trim() }),
            })
            setRollbackTarget(null)
            toast.success(t('common.success'))
            await loadCheckpoints()
          } catch (err) {
            toast.error(errorMessage(err, t))
          } finally {
            setRollbackBusy(false)
          }
        }}
      >
        {rollbackTarget && (
          <div className="space-y-3">
            <p className="m-0 text-sm text-error">{t('config.ckptRollbackWarn')}</p>
            <p className="m-0 text-sm">{t('config.ckptRollbackHint', { id: rollbackTarget.id })}</p>
            <label className="form-control w-full">
              <span className="label-text text-xs">{t('config.ckptPhrase')}</span>
              <input
                className="input input-bordered input-sm w-full font-mono"
                value={rollbackPhrase}
                onChange={(e) => setRollbackPhrase(e.target.value)}
                placeholder={rollbackTarget.id}
                autoComplete="off"
              />
              {rollbackError && <span className="text-error text-xs mt-1">{rollbackError}</span>}
            </label>
          </div>
        )}
      </Modal>

      <ConfirmDanger
        open={!!pendingDelBackup}
        title={t('config.backupDelete')}
        description={t('config.backupDeleteConfirm', { stamp: pendingDelBackup?.stamp ?? '' })}
        onCancel={() => setPendingDelBackup(null)}
        onConfirm={async () => {
          const stamp = pendingDelBackup?.stamp
          setPendingDelBackup(null)
          if (!stamp) return
          try {
            await api(`/api/v1/backup/${encodeURIComponent(stamp)}`, {
              method: 'DELETE',
              body: JSON.stringify({ confirm: true }),
            })
            toast.success(t('common.success'))
            await loadBackups()
          } catch (err) {
            toast.error(errorMessage(err, t))
          }
        }}
      />

      <ConfirmDanger
        open={!!pendingDelCkpt}
        title={t('config.ckptDelete')}
        description={t('config.ckptDeleteConfirm', { id: pendingDelCkpt?.id ?? '' })}
        onCancel={() => setPendingDelCkpt(null)}
        onConfirm={async () => {
          const id = pendingDelCkpt?.id
          setPendingDelCkpt(null)
          if (!id) return
          try {
            await api(`/api/v1/modules/checkpoints/${encodeURIComponent(id)}`, {
              method: 'DELETE',
              body: JSON.stringify({ confirm: true }),
            })
            toast.success(t('common.success'))
            await loadCheckpoints()
          } catch (err) {
            toast.error(errorMessage(err, t))
          }
        }}
      />
    </div>
  )
}
