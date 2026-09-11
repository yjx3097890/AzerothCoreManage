import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { api, errorMessage, getTargetId, getToken } from '../api/client'
import { currentLocale } from '../i18n'
import { DataTable, Modal, Select, Tabs, toast, type Column } from '../ui'

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
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = searchParams.get('tab') === 'logs' ? 'logs' : 'containers'
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
          <button
            type="button"
            className="btn btn-xs btn-ghost"
            disabled={!row.found}
            onClick={() => setSearchParams({ tab: 'logs', c: row.role || row.name })}
          >
            {t('servers.viewLogs')}
          </button>
        </div>
      ),
    },
  ]

  return (
    <div>
      <div className="flex w-full items-center justify-between gap-2 mb-4">
        <div>
          <h2 className="text-xl font-semibold m-0">{t('pages.servers.title')}</h2>
          <p className="text-sm text-base-content/60 m-0 mt-1">{t('servers.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          {tab === 'containers' && (
            <>
              <button type="button" className="btn btn-sm" onClick={() => void load()}>
                {t('common.refresh')}
              </button>
              <button type="button" className="btn btn-sm btn-error" onClick={() => setLifecycleOpen(true)}>
                {t('servers.lifecycle')}
              </button>
            </>
          )}
        </div>
      </div>

      <Tabs
        activeKey={tab}
        onChange={(key) => {
          if (key === 'logs') {
            setSearchParams({ tab: 'logs' })
          } else {
            setSearchParams({})
          }
        }}
        items={[
          {
            key: 'containers',
            label: t('servers.tabContainers'),
            children: !data ? (
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
            ),
          },
          {
            key: 'logs',
            label: t('servers.tabLogs'),
            children: (
              <ContainerLogsPanel
                initialContainer={searchParams.get('c') || 'worldserver'}
                dockerEnabled={data?.enabled !== false}
              />
            ),
          },
        ]}
      />

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

function ContainerLogsPanel({
  initialContainer,
  dockerEnabled,
}: {
  initialContainer: string
  dockerEnabled: boolean
}) {
  const { t } = useTranslation()
  const [container, setContainer] = useState(initialContainer || 'worldserver')
  const [level, setLevel] = useState('')
  const [lines, setLines] = useState<string[]>([])
  const [live, setLive] = useState(false)
  const [dockerDisabled, setDockerDisabled] = useState(!dockerEnabled)
  const abortRef = useRef<AbortController | null>(null)
  const boxRef = useRef<HTMLPreElement | null>(null)

  useEffect(() => {
    setContainer(initialContainer || 'worldserver')
  }, [initialContainer])

  const loadSnapshot = async () => {
    try {
      const params = new URLSearchParams({ tail: '200' })
      if (level) params.set('level', level)
      const data = await api<{ lines: string[] }>(
        `/api/v1/servers/${encodeURIComponent(container)}/logs?${params}`,
      )
      setDockerDisabled(false)
      setLines(data.lines)
    } catch (err) {
      const msg = errorMessage(err, t)
      if (String((err as { code?: string }).code) === 'docker_disabled') {
        setDockerDisabled(true)
      }
      toast.error(msg)
    }
  }

  const stopLive = () => {
    abortRef.current?.abort()
    abortRef.current = null
    setLive(false)
  }

  const startLive = () => {
    stopLive()
    const ac = new AbortController()
    abortRef.current = ac
    setLive(true)
    setLines([])

    void (async () => {
      try {
        const params = new URLSearchParams({ tail: '100' })
        if (level) params.set('level', level)
        const headers = new Headers({
          Accept: 'text/event-stream',
        })
        const token = getToken()
        if (token) headers.set('Authorization', `Bearer ${token}`)
        headers.set('X-Locale', currentLocale())
        headers.set('Accept-Language', currentLocale())
        const target = getTargetId()
        if (target) headers.set('X-Target-Id', target)

        const res = await fetch(
          `/api/v1/servers/${encodeURIComponent(container)}/logs/stream?${params}`,
          { headers, signal: ac.signal },
        )
        if (!res.ok || !res.body) {
          let msg = res.statusText
          try {
            const body = (await res.json()) as { error?: { code?: string; message?: string } }
            msg = body.error?.message || msg
            if (body.error?.code === 'docker_disabled') setDockerDisabled(true)
          } catch {
            /* ignore */
          }
          throw new Error(msg || t('logs.streamError'))
        }
        setDockerDisabled(false)

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const chunks = buffer.split('\n\n')
          buffer = chunks.pop() || ''
          for (const chunk of chunks) {
            const rawLines = chunk.split('\n')
            let event = 'message'
            const dataLines: string[] = []
            for (const line of rawLines) {
              if (line.startsWith(':')) continue // SSE comment / ping
              if (line.startsWith('event:')) event = line.slice(6).trim()
              else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
            }
            if (!dataLines.length) continue
            try {
              const data = JSON.parse(dataLines.join('\n')) as { line?: string; message?: string }
              if (event === 'line' && data.line) {
                setLines((prev) => [...prev.slice(-500), data.line!])
              } else if (event === 'error') {
                toast.error(data.message || t('logs.streamError'))
                stopLive()
                return
              } else if (event === 'done') {
                stopLive()
                return
              }
            } catch {
              /* ignore malformed chunk */
            }
          }
        }
      } catch (err) {
        if (ac.signal.aborted) return
        toast.error(err instanceof Error ? err.message : t('logs.streamError'))
      } finally {
        if (abortRef.current === ac) {
          abortRef.current = null
          setLive(false)
        }
      }
    })()
  }

  useEffect(() => () => stopLive(), [])

  useEffect(() => {
    if (boxRef.current) {
      boxRef.current.scrollTop = boxRef.current.scrollHeight
    }
  }, [lines])

  useEffect(() => {
    void loadSnapshot()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when container changes
  }, [container])

  return (
    <div>
      <div className="flex w-full flex-wrap items-center gap-2 mb-3">
        <Select
          className="w-40"
          value={container}
          onChange={(v) => {
            stopLive()
            setContainer(v ?? 'worldserver')
          }}
          options={[
            { value: 'worldserver', label: t('logs.worldserver') },
            { value: 'authserver', label: t('logs.authserver') },
            { value: 'database', label: t('logs.database') },
          ]}
        />
        <div className="join">
          <input
            className="input input-bordered input-sm join-item w-36"
            placeholder={t('logs.levelFilter')}
            value={level}
            onChange={(e) => setLevel(e.target.value)}
          />
          {level && (
            <button type="button" className="btn btn-sm join-item" onClick={() => setLevel('')}>
              ✕
            </button>
          )}
        </div>
        <button type="button" className="btn btn-sm" onClick={() => void loadSnapshot()}>
          {t('logs.snapshot')}
        </button>
        {!live ? (
          <button type="button" className="btn btn-sm btn-primary" onClick={startLive} disabled={!dockerEnabled}>
            {t('logs.live')}
          </button>
        ) : (
          <button type="button" className="btn btn-sm btn-error" onClick={stopLive}>
            {t('logs.stop')}
          </button>
        )}
      </div>

      {(dockerDisabled || !dockerEnabled) && (
        <div className="alert alert-info mb-3">{t('dashboard.dockerDisabled')}</div>
      )}

      <pre
        ref={boxRef}
        className="bg-neutral text-neutral-content p-3 h-[60vh] overflow-auto text-xs rounded-md"
      >
        {lines.join('\n') || t('logs.empty')}
      </pre>
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
        <p className="text-sm text-base-content/65 m-0 leading-relaxed">{t('servers.lifecycleNote')}</p>
      </div>
    </Modal>
  )
}

