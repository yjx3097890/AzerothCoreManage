import { Button, Form, Input, List, Space, Typography, message } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, errorMessage } from '../api/client'
import { ConfirmDanger } from '../components/ConfirmDanger'

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
      message.error(errorMessage(err, t))
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
        message.error(errorMessage(err, t))
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
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }} wrap>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {t('pages.config.title')}
        </Typography.Title>
        <Space wrap>
          <Button onClick={() => void loadFiles()}>{t('common.refresh')}</Button>
          <Button danger type="primary" onClick={() => setPendingBackup(true)}>
            {t('config.backup')}
          </Button>
        </Space>
      </Space>

      <Typography.Title level={5}>{t('config.files')}</Typography.Title>
      <List
        loading={loading && !selected}
        bordered
        style={{ marginBottom: 16, maxWidth: 640 }}
        dataSource={files}
        renderItem={(item) => (
          <List.Item
            actions={[
              <Button
                key="open"
                size="small"
                disabled={!item.available}
                type={selected === item.id ? 'primary' : 'default'}
                onClick={() => void loadFile(item.id)}
              >
                {t('config.open')}
              </Button>,
            ]}
          >
            <List.Item.Meta
              title={item.id}
              description={
                item.available
                  ? `${item.path}${item.size != null ? ` · ${item.size} B` : ''}`
                  : item.error || t('config.unavailable')
              }
            />
          </List.Item>
        )}
      />

      {selected && (
        <Form layout="vertical" style={{ maxWidth: 960 }}>
          <Typography.Text type="secondary">{path}</Typography.Text>
          <Form.Item label={t('config.content')} style={{ marginTop: 8 }}>
            <Input.TextArea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={24}
              style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }}
            />
          </Form.Item>
          <Button type="primary" onClick={() => setPendingSave(true)}>
            {t('config.save')}
          </Button>
        </Form>
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
            message.success(t('common.ok'))
            setPendingSave(false)
            void loadFiles()
          } catch (err) {
            message.error(errorMessage(err, t))
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
            message.success(t('common.ok'))
            setPendingBackup(false)
          } catch (err) {
            message.error(errorMessage(err, t))
          }
        }}
      />
    </div>
  )
}
