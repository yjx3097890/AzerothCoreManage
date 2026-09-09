import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, errorMessage } from '../api/client'
import { DataTable, Modal, Select, toast, type Column } from '../ui'

type ServerItem = {
  role: string
  name: string
  running: boolean
  found: boolean
  status: string
}

type ServersResp = {
  enabled: boolean
  items: ServerItem[]
  message?: string
}

export function ServersPage() {
  const { t } = useTranslation()
  const [data, setData] = useState<ServersResp | null>(null)
  const [loading, setLoading] = useState(false)
  const [lifecycleOpen, setLifecycleOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const resp = await api<ServersResp>('/api/v1/servers')
      setData(resp)
    } catch (err) {
      toast.error(errorMessage(err, t))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const act = async (name: string, action: 'start' | 'stop' | 'restart') => {
    try {
      await api(`/api/v1/servers/${encodeURIComponent(name)}/${action}`, { method: 'POST', body: '{}' })
      toast.success(t('servers.actionOk'))
      await load()
    } catch (err) {
      toast.error(errorMessage(err, t))
    }
  }

  const columns: Column<ServerItem>[] = [
    { key: 'role', title: t('servers.role'), dataIndex: 'role' },
    { key: 'name', title: t('servers.name'), dataIndex: 'name' },
    {
      key: 'status',
      title: t('servers.status'),
      render: (_, row) =>
        !row.found ? (
          <span className="badge">{t('servers.notFound')}</span>
        ) : row.running ? (
          <span className="badge badge-success">{row.status}</span>
        ) : (
          <span className="badge">{row.status}</span>
        ),
    },
    {
      key: 'actions',
      title: t('common.actions'),
      render: (_, row) => (
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn btn-xs"
            disabled={!row.found || row.running}
            onClick={() => void act(row.name, 'start')}
          >
            {t('servers.start')}
          </button>
          <button
            type="button"
            className="btn btn-xs"
            disabled={!row.found || !row.running}
            onClick={() => void act(row.name, 'stop')}
          >
            {t('servers.stop')}
          </button>
          <button
            type="button"
            className="btn btn-xs"
            disabled={!row.found}
            onClick={() => void act(row.name, 'restart')}
          >
            {t('servers.restart')}
          </button>
        </div>
      ),
    },
  ]

  return (
    <div>
      <div className="flex w-full items-center justify-between gap-2 mb-4">
        <h2 className="text-xl font-semibold m-0">{t('pages.servers.title')}</h2>
        <div className="flex items-center gap-2">
          <button type="button" className="btn btn-sm" onClick={() => void load()}>
            {t('common.refresh')}
          </button>
          <button type="button" className="btn btn-sm btn-error" onClick={() => setLifecycleOpen(true)}>
            {t('servers.lifecycle')}
          </button>
        </div>
      </div>

      {!data ? (
        <div className="alert alert-info">{t('common.loading')}</div>
      ) : !data.enabled ? (
        <div className="alert alert-info">
          <div>
            <div className="font-medium">{t('dashboard.dockerDisabled')}</div>
            {data.message && <div className="text-sm opacity-80">{data.message}</div>}
          </div>
        </div>
      ) : (
        <DataTable loading={loading} rowKey="name" dataSource={data.items} columns={columns} />
      )}

      <LifecycleModal
        open={lifecycleOpen}
        onClose={() => setLifecycleOpen(false)}
        onDone={() => {
          setLifecycleOpen(false)
          void load()
        }}
      />
    </div>
  )
}

function LifecycleModal({
  open,
  onClose,
  onDone,
}: {
  open: boolean
  onClose: () => void
  onDone: () => void
}) {
  const { t } = useTranslation()
  const [action, setAction] = useState('')
  const [delay, setDelay] = useState(30)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setAction('')
      setDelay(30)
      setSubmitting(false)
    }
  }, [open])

  const submit = async () => {
    if (!action) {
      toast.error(t('validation.required'))
      return
    }
    setSubmitting(true)
    try {
      await api('/api/v1/servers/lifecycle', {
        method: 'POST',
        body: JSON.stringify({
          action,
          delay,
          confirm: action === 'restart' || action === 'shutdown',
        }),
      })
      toast.success(t('servers.actionOk'))
      onDone()
    } catch (err) {
      toast.error(errorMessage(err, t))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      title={t('servers.lifecycle')}
      onClose={onClose}
      confirmLoading={submitting}
      onOk={() => void submit()}
    >
      <div className="flex flex-col gap-3">
        <label className="form-control w-full">
          <span className="label-text mb-1">{t('servers.action')}</span>
          <Select
            value={action}
            onChange={(v) => setAction(v ?? '')}
            placeholder={t('servers.action')}
            options={[
              { value: 'restart', label: t('servers.soapRestart') },
              { value: 'shutdown', label: t('servers.soapShutdown') },
              { value: 'restart_cancel', label: t('servers.cancelRestart') },
              { value: 'shutdown_cancel', label: t('servers.cancelShutdown') },
            ]}
          />
        </label>
        <label className="form-control w-full">
          <span className="label-text mb-1">{t('servers.delaySeconds')}</span>
          <input
            type="number"
            min={1}
            max={3600}
            className="input input-bordered w-full"
            value={delay}
            onChange={(e) => setDelay(Number(e.target.value))}
          />
        </label>
        <div className="alert alert-warning">{t('servers.lifecycleHint')}</div>
      </div>
    </Modal>
  )
}
