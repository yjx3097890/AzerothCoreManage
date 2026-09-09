import { Alert, Button, Input, Select, Space, Typography, message } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, errorMessage, getToken } from '../api/client'

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
      message.error(msg)
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
          message.error(msg.message || t('logs.wsError'))
          stopLive()
        }
      } catch {
        /* ignore */
      }
    }
    ws.onerror = () => {
      message.error(t('logs.wsError'))
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
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }} wrap>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {t('pages.logs.title')}
        </Typography.Title>
        <Space wrap>
          <Select
            value={container}
            style={{ width: 160 }}
            onChange={setContainer}
            options={[
              { value: 'worldserver', label: t('logs.worldserver') },
              { value: 'authserver', label: t('logs.authserver') },
              { value: 'database', label: t('logs.database') },
            ]}
          />
          <Input
            allowClear
            placeholder={t('logs.levelFilter')}
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            style={{ width: 140 }}
          />
          <Button onClick={() => void loadSnapshot()}>{t('logs.snapshot')}</Button>
          {!live ? (
            <Button type="primary" onClick={startLive}>
              {t('logs.live')}
            </Button>
          ) : (
            <Button danger onClick={stopLive}>
              {t('logs.stop')}
            </Button>
          )}
        </Space>
      </Space>

      {dockerDisabled && <Alert type="info" showIcon style={{ marginBottom: 16 }} message={t('dashboard.dockerDisabled')} />}

      <pre
        ref={boxRef}
        style={{
          background: '#111',
          color: '#d6d6d6',
          padding: 12,
          height: '60vh',
          overflow: 'auto',
          fontSize: 12,
          borderRadius: 6,
        }}
      >
        {lines.join('\n') || t('logs.empty')}
      </pre>
    </div>
  )
}
