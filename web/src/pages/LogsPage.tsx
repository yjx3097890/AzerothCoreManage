import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, errorMessage, getToken } from '../api/client'
import { Select, toast } from '../ui'

export function LogsPage() {
  const { t } = useTranslation()
  const [container, setContainer] = useState('worldserver')
  const [level, setLevel] = useState('')
  const [lines, setLines] = useState<string[]>([])
  const [live, setLive] = useState(false)
  const [dockerDisabled, setDockerDisabled] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const boxRef = useRef<HTMLPreElement | null>(null)

  const loadSnapshot = async () => {
    try {
      const params = new URLSearchParams({ tail: '200' })
      if (level) params.set('level', level)
      const data = await api<{ lines: string[] }>(`/api/v1/servers/${encodeURIComponent(container)}/logs?${params}`)
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
    wsRef.current?.close()
    wsRef.current = null
    setLive(false)
  }

  const startLive = () => {
    stopLive()
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const params = new URLSearchParams({
      token: getToken(),
      tail: '100',
    })
    if (level) params.set('level', level)
    const ws = new WebSocket(`${proto}://${location.host}/api/v1/servers/${encodeURIComponent(container)}/logs/ws?${params}`)
    wsRef.current = ws
    setLive(true)
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as { type: string; line?: string; message?: string }
        if (msg.type === 'line' && msg.line) {
          setLines((prev) => [...prev.slice(-500), msg.line!])
        }
        if (msg.type === 'error') {
          toast.error(msg.message || t('logs.wsError'))
          stopLive()
        }
      } catch {
        /* ignore */
      }
    }
    ws.onerror = () => {
      toast.error(t('logs.wsError'))
      stopLive()
    }
    ws.onclose = () => setLive(false)
  }

  useEffect(() => () => stopLive(), [])

  useEffect(() => {
    if (boxRef.current) {
      boxRef.current.scrollTop = boxRef.current.scrollHeight
    }
  }, [lines])

  return (
    <div>
      <div className="flex w-full flex-wrap items-center justify-between gap-2 mb-4">
        <h2 className="text-xl font-semibold m-0">{t('pages.logs.title')}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            className="w-40"
            value={container}
            onChange={(v) => setContainer(v ?? 'worldserver')}
            options={[
              { value: 'worldserver', label: t('logs.worldserver') },
              { value: 'authserver', label: t('logs.authserver') },
              { value: 'database', label: t('logs.database') },
            ]}
          />
          <div className="join">
            <input
              className="input input-bordered join-item w-36"
              placeholder={t('logs.levelFilter')}
              value={level}
              onChange={(e) => setLevel(e.target.value)}
            />
            {level && (
              <button type="button" className="btn join-item" onClick={() => setLevel('')}>
                ✕
              </button>
            )}
          </div>
          <button type="button" className="btn btn-sm" onClick={() => void loadSnapshot()}>
            {t('logs.snapshot')}
          </button>
          {!live ? (
            <button type="button" className="btn btn-sm btn-primary" onClick={startLive}>
              {t('logs.live')}
            </button>
          ) : (
            <button type="button" className="btn btn-sm btn-error" onClick={stopLive}>
              {t('logs.stop')}
            </button>
          )}
        </div>
      </div>

      {dockerDisabled && <div className="alert alert-info mb-4">{t('dashboard.dockerDisabled')}</div>}

      <pre
        ref={boxRef}
        className="bg-neutral text-neutral-content p-3 h-[60vh] overflow-auto text-xs rounded-md"
      >
        {lines.join('\n') || t('logs.empty')}
      </pre>
    </div>
  )
}
