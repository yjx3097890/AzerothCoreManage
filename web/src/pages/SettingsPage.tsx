import { Alert, Button, Form, Input, InputNumber, Select, Typography, message } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, errorMessage, getTargetId, hasMinRole, setTargetId } from '../api/client'
import { ConfirmDanger } from '../components/ConfirmDanger'
import { MapSelect, TeleSelect } from '../components/PlaceSelect'

type Target = { id: string; name: string; docker_enabled: boolean }

type Pending =
  | { kind: 'soap'; cmd: string }
  | {
      kind: 'teleAdd'
      payload: { name: string; map: number; x: number; y: number; z: number; orientation: number }
    }
  | { kind: 'teleDel'; name: string }

export function SettingsPage() {
  const { t } = useTranslation()
  const [targets, setTargets] = useState<Target[]>([])
  const [target, setTarget] = useState(getTargetId())
  const [pending, setPending] = useState<Pending | null>(null)
  const [result, setResult] = useState('')
  const [teleAddForm] = Form.useForm()
  const [teleDelForm] = Form.useForm()

  useEffect(() => {
    void api<{ items: Target[] }>('/api/v1/targets')
      .then((d) => {
        setTargets(d.items)
        if (!getTargetId() && d.items[0]) {
          setTargetId(d.items[0].id)
          setTarget(d.items[0].id)
        }
      })
      .catch((err) => message.error(errorMessage(err, t)))
  }, [t])

  return (
    <div style={{ maxWidth: 720 }}>
      <Typography.Title level={3}>{t('pages.settings.title')}</Typography.Title>

      <Typography.Title level={5}>{t('settings.target')}</Typography.Title>
      <Select
        style={{ width: 320, marginBottom: 24 }}
        value={target || undefined}
        options={targets.map((x) => ({ value: x.id, label: `${x.name} (${x.id})` }))}
        onChange={(v) => {
          setTargetId(v)
          setTarget(v)
          message.success(t('settings.targetSwitched'))
        }}
      />

      <Typography.Title level={5}>{t('settings.reload')}</Typography.Title>
      <Form
        layout="inline"
        style={{ marginBottom: 24 }}
        initialValues={{ table: 'config' }}
        onFinish={(values: { table: string }) => {
          setPending({ kind: 'soap', cmd: `reload ${values.table}` })
        }}
      >
        <Form.Item name="table" rules={[{ required: true }]}>
          <Select
            style={{ width: 160 }}
            options={['config', 'loot', 'quest', 'creature', 'motd', 'tele', 'item', 'spell', 'all'].map((v) => ({
              value: v,
              label: v,
            }))}
          />
        </Form.Item>
        <Button htmlType="submit">{t('settings.doReload')}</Button>
      </Form>

      {hasMinRole('gm') && (
        <>
          <Typography.Title level={5}>{t('settings.teleManage')}</Typography.Title>
          <Form
            form={teleAddForm}
            layout="inline"
            style={{ marginBottom: 12 }}
            onFinish={(values: {
              name: string
              map: number
              x: number
              y: number
              z: number
              orientation: number
            }) => {
              setPending({
                kind: 'teleAdd',
                payload: {
                  name: values.name,
                  map: values.map,
                  x: values.x,
                  y: values.y,
                  z: values.z,
                  orientation: values.orientation ?? 0,
                },
              })
            }}
          >
            <Form.Item name="name" rules={[{ required: true }]}>
              <Input placeholder={t('characters.name')} style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="map" rules={[{ required: true }]}>
              <MapSelect style={{ width: 220 }} />
            </Form.Item>
            <Form.Item name="x" rules={[{ required: true }]}>
              <InputNumber placeholder={t('settings.coordX')} style={{ width: 90 }} />
            </Form.Item>
            <Form.Item name="y" rules={[{ required: true }]}>
              <InputNumber placeholder={t('settings.coordY')} style={{ width: 90 }} />
            </Form.Item>
            <Form.Item name="z" rules={[{ required: true }]}>
              <InputNumber placeholder={t('settings.coordZ')} style={{ width: 90 }} />
            </Form.Item>
            <Form.Item name="orientation" initialValue={0}>
              <InputNumber placeholder={t('settings.orientation')} style={{ width: 80 }} />
            </Form.Item>
            <Button type="primary" htmlType="submit">
              {t('settings.teleAdd')}
            </Button>
          </Form>
          <Form
            form={teleDelForm}
            layout="inline"
            style={{ marginBottom: 24 }}
            onFinish={(values: { name: string }) => setPending({ kind: 'teleDel', name: values.name })}
          >
            <Form.Item name="name" rules={[{ required: true }]}>
              <TeleSelect style={{ width: 280 }} />
            </Form.Item>
            <Button danger htmlType="submit">
              {t('settings.teleDel')}
            </Button>
          </Form>
        </>
      )}

      <Typography.Title level={5}>{t('settings.soap')}</Typography.Title>
      <Alert type="warning" showIcon message={t('settings.soapHint')} style={{ marginBottom: 12 }} />
      <Form
        layout="vertical"
        onFinish={(values: { command: string }) => setPending({ kind: 'soap', cmd: values.command })}
      >
        <Form.Item name="command" label={t('settings.command')} rules={[{ required: true }]}>
          <Input.TextArea rows={3} placeholder={t('settings.soapPlaceholder')} />
        </Form.Item>
        <Button type="primary" htmlType="submit">
          {t('settings.exec')}
        </Button>
      </Form>

      {result && (
        <pre style={{ marginTop: 16, background: '#111', color: '#ddd', padding: 12, whiteSpace: 'pre-wrap' }}>{result}</pre>
      )}

      <ConfirmDanger
        open={!!pending}
        description={
          pending?.kind === 'soap'
            ? t('settings.execConfirm', { cmd: pending.cmd })
            : pending?.kind === 'teleAdd'
              ? t('settings.teleAddConfirm', { name: pending.payload.name })
              : pending?.kind === 'teleDel'
                ? t('settings.teleDelConfirm', { name: pending.name })
                : undefined
        }
        onCancel={() => setPending(null)}
        onConfirm={async () => {
          if (!pending) return
          try {
            if (pending.kind === 'soap') {
              const isReload = pending.cmd.startsWith('reload ')
              const data = isReload
                ? await api<{ result: string }>('/api/v1/reload', {
                    method: 'POST',
                    body: JSON.stringify({ table: pending.cmd.replace(/^reload\s+/, ''), confirm: true }),
                  })
                : await api<{ result: string }>('/api/v1/soap/exec', {
                    method: 'POST',
                    body: JSON.stringify({ command: pending.cmd, confirm: true }),
                  })
              setResult(data.result || JSON.stringify(data))
            } else if (pending.kind === 'teleAdd') {
              await api('/api/v1/teleports', {
                method: 'POST',
                body: JSON.stringify({ ...pending.payload, confirm: true, reload: true }),
              })
              teleAddForm.resetFields()
            } else {
              await api(`/api/v1/teleports/${encodeURIComponent(pending.name)}`, {
                method: 'DELETE',
                body: JSON.stringify({ confirm: true }),
              })
              teleDelForm.resetFields()
            }
            message.success(t('common.ok'))
            setPending(null)
          } catch (err) {
            message.error(errorMessage(err, t))
          }
        }}
      />
    </div>
  )
}
