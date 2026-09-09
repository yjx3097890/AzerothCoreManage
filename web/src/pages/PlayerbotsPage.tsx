import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Form,
  Input,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tooltip,
  Typography,
  message,
} from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, errorMessage, hasMinRole } from '../api/client'
import { ConfirmDanger } from '../components/ConfirmDanger'
import { classLabel } from '../utils/wowLabels'

type Overview = {
  account_prefix: string
  rndbot_accounts: number
  online_bots: number
  note_key?: string
  note?: string
}

type BotRow = {
  guid: number
  name: string
  account: string
  race: number
  race_name?: string
  class: number
  class_name?: string
  level: number
  map: number
  map_name?: string
  zone: number
  zone_name?: string
}

type BotGuild = { id: number; name: string; bot_members: number }

const CONFIG_KEYS = [
  'AiPlayerbot.RandomBotAutologin',
  'AiPlayerbot.MinRandomBots',
  'AiPlayerbot.MaxRandomBots',
  'AiPlayerbot.RandomBotMinLevel',
  'AiPlayerbot.RandomBotMaxLevel',
  'AiPlayerbot.DisableDeathKnightLogin',
  'AiPlayerbot.RandomBotAccountPrefix',
  'AiPlayerbot.RandomBotAccountCount',
  'AiPlayerbot.AutoGearQuality',
  'AiPlayerbot.RandomBotTimedLogout',
  'AiPlayerbot.RandomBotTimedOffline',
]

export function PlayerbotsPage() {
  const { t, i18n } = useTranslation()
  const [overview, setOverview] = useState<Overview | null>(null)
  const [stats, setStats] = useState('')
  const [online, setOnline] = useState<BotRow[]>([])
  const [config, setConfig] = useState<{
    available: boolean
    values?: Record<string, string>
    message?: string
  } | null>(null)
  const [guilds, setGuilds] = useState<BotGuild[]>([])
  const [accountResult, setAccountResult] = useState('')
  const [configForm] = Form.useForm()
  const [pending, setPending] = useState<{ title: string; description: string; run: () => Promise<void> } | null>(null)

  const load = useCallback(async () => {
    try {
      const [ov, bots, conf, g] = await Promise.all([
        api<Overview>('/api/v1/playerbots/overview'),
        api<{ items: BotRow[] }>('/api/v1/playerbots/online'),
        api<{ available: boolean; values?: Record<string, string>; message?: string }>(
          '/api/v1/playerbots/config',
        ),
        api<{ items: BotGuild[] }>('/api/v1/playerbots/guilds'),
      ])
      setOverview(ov)
      setOnline(bots.items)
      setConfig(conf)
      setGuilds(g.items)
      if (conf.values) configForm.setFieldsValue(conf.values)
    } catch (err) {
      message.error(errorMessage(err, t))
    }
  }, [configForm, t])

  useEffect(() => {
    void load()
  }, [load, i18n.language])

  const loadStats = async () => {
    try {
      const data = await api<{ raw: string }>('/api/v1/playerbots/stats')
      setStats(data.raw)
    } catch (err) {
      message.error(errorMessage(err, t))
    }
  }

  const runAction = (action: string, needsConfirm: boolean, arg?: string) => {
    const exec = async () => {
      await api(`/api/v1/playerbots/rndbot/${action}`, {
        method: 'POST',
        body: JSON.stringify({ arg, confirm: true }),
      })
      await load()
      if (action === 'stats' || action === 'reload') await loadStats()
    }
    if (!needsConfirm) {
      void exec()
        .then(() => message.success(t('common.ok')))
        .catch((err) => message.error(errorMessage(err, t)))
      return
    }
    setPending({
      title: t('playerbots.rndbotTitle', { action }),
      description: t('playerbots.actionConfirm', { action }),
      run: exec,
    })
  }

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {t('pages.playerbots.title')}
        </Typography.Title>
        <Button onClick={() => void load()}>{t('common.refresh')}</Button>
      </Space>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Card>
            <Statistic
              title={<Tooltip title={t('playerbots.accountsHint')}>{t('playerbots.accounts')}</Tooltip>}
              value={overview?.rndbot_accounts ?? '-'}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic
              title={<Tooltip title={t('playerbots.onlineHint')}>{t('playerbots.online')}</Tooltip>}
              value={overview?.online_bots ?? '-'}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic
              title={<Tooltip title={t('playerbots.prefixHint')}>{t('playerbots.prefix')}</Tooltip>}
              value={overview?.account_prefix ?? '-'}
            />
          </Card>
        </Col>
      </Row>

      {(overview?.note_key === 'prefix_stats_only' || overview?.note) && (
        <Alert
          style={{ marginBottom: 16 }}
          type="info"
          showIcon
          message={
            overview?.note_key === 'prefix_stats_only' ? t('playerbots.notePrefixStats') : overview?.note
          }
        />
      )}

      <Space wrap style={{ marginBottom: 16 }}>
        <Tooltip title={t('playerbots.statsHint')}>
          <Button onClick={() => void loadStats()}>{t('playerbots.stats')}</Button>
        </Tooltip>
        {hasMinRole('gm') && (
          <>
            <Tooltip title={t('playerbots.reloadHint')}>
              <Button onClick={() => runAction('reload', false)}>{t('playerbots.reload')}</Button>
            </Tooltip>
            <Tooltip title={t('playerbots.refreshHint')}>
              <Button onClick={() => runAction('refresh', true)}>{t('playerbots.refresh')}</Button>
            </Tooltip>
            <Tooltip title={t('playerbots.teleportHint')}>
              <Button onClick={() => runAction('teleport', true)}>{t('playerbots.teleport')}</Button>
            </Tooltip>
            <Tooltip title={t('playerbots.initHint')}>
              <Button danger onClick={() => runAction('init', true)}>
                {t('playerbots.init')}
              </Button>
            </Tooltip>
            <Tooltip title={t('playerbots.resetHint')}>
              <Button danger onClick={() => runAction('reset', true)}>
                {t('playerbots.reset')}
              </Button>
            </Tooltip>
          </>
        )}
      </Space>

      {hasMinRole('gm') && (
        <>
          <Form
            layout="inline"
            style={{ marginBottom: 16 }}
            onFinish={(values: { level: string }) => runAction('level', true, values.level)}
          >
            <Form.Item name="level" rules={[{ required: true }]} tooltip={t('playerbots.levelArgHint')}>
              <Input placeholder={t('playerbots.levelArg')} />
            </Form.Item>
            <Tooltip title={t('playerbots.setLevelHint')}>
              <Button htmlType="submit">{t('playerbots.setLevel')}</Button>
            </Tooltip>
          </Form>

          <Typography.Title level={5}>{t('playerbots.pmon')}</Typography.Title>
          <Space wrap style={{ marginBottom: 16 }}>
            {(
              [
                { action: 'toggle', label: t('playerbots.pmonToggle'), hint: t('playerbots.pmonToggleHint') },
                { action: 'stack', label: t('playerbots.pmonStack'), hint: t('playerbots.pmonStackHint') },
                { action: 'tick', label: t('playerbots.pmonTick'), hint: t('playerbots.pmonTickHint') },
                { action: 'reset', label: t('playerbots.pmonReset'), hint: t('playerbots.pmonResetHint') },
              ] as const
            ).map(({ action, label, hint }) => (
              <Tooltip key={action} title={hint}>
                <Button
                  danger={action === 'toggle' || action === 'reset'}
                  onClick={() => {
                    const needsConfirm = action === 'toggle' || action === 'reset'
                    const exec = async () => {
                      await api('/api/v1/playerbots/pmon', {
                        method: 'POST',
                        body: JSON.stringify({ action, confirm: true }),
                      })
                    }
                    if (!needsConfirm) {
                      void exec()
                        .then(() => message.success(t('common.ok')))
                        .catch((err) => message.error(errorMessage(err, t)))
                      return
                    }
                    setPending({
                      title: t('playerbots.pmon'),
                      description: t('playerbots.pmonConfirm', { action }),
                      run: exec,
                    })
                  }}
                >
                  {t('playerbots.pmon')} {label}
                </Button>
              </Tooltip>
            ))}
          </Space>

          <Typography.Title level={5}>{t('playerbots.bots')}</Typography.Title>
          <Form
            layout="inline"
            style={{ marginBottom: 16 }}
            initialValues={{ action: 'add' }}
            onFinish={(values: { action: string; name?: string; account?: string; class?: string }) => {
              setPending({
                title: t('playerbots.bots'),
                description: t('playerbots.botsConfirm', {
                  action: values.action,
                  name: values.name ?? values.account ?? values.class ?? '',
                }),
                run: async () => {
                  await api('/api/v1/playerbots/bots', {
                    method: 'POST',
                    body: JSON.stringify({ ...values, confirm: true }),
                  })
                  await load()
                },
              })
            }}
          >
            <Form.Item name="action" rules={[{ required: true }]}>
              <Select
                style={{ width: 140 }}
                optionLabelProp="label"
                options={[
                  { value: 'add', label: t('common.add'), title: t('playerbots.botsAddHint') },
                  { value: 'remove', label: t('common.remove'), title: t('playerbots.botsRemoveHint') },
                  { value: 'addaccount', label: t('playerbots.addAccount'), title: t('playerbots.addAccountHint') },
                  { value: 'addclass', label: t('playerbots.addClass'), title: t('playerbots.addClassHint') },
                ]}
                optionRender={(opt) => (
                  <Tooltip placement="right" title={opt.data.title as string}>
                    <span>{opt.data.label as string}</span>
                  </Tooltip>
                )}
              />
            </Form.Item>
            <Form.Item noStyle shouldUpdate={(a, b) => a.action !== b.action}>
              {({ getFieldValue }) => {
                const action = getFieldValue('action') as string
                if (action === 'add' || action === 'remove') {
                  return (
                    <Form.Item name="name" rules={[{ required: true }]}>
                      <Input placeholder={t('characters.name')} />
                    </Form.Item>
                  )
                }
                if (action === 'addaccount') {
                  return (
                    <Form.Item name="account" rules={[{ required: true }]}>
                      <Input placeholder={t('accounts.username')} />
                    </Form.Item>
                  )
                }
                return (
                  <Form.Item name="class" rules={[{ required: true }]} tooltip={t('playerbots.addClassHint')}>
                    <Input placeholder={t('common.class')} />
                  </Form.Item>
                )
              }}
            </Form.Item>
            <Tooltip title={t('playerbots.botsHint')}>
              <Button htmlType="submit">{t('playerbots.bots')}</Button>
            </Tooltip>
          </Form>

          <Typography.Title level={5}>{t('playerbots.account')}</Typography.Title>
          <Form
            layout="inline"
            style={{ marginBottom: 16 }}
            initialValues={{ action: 'list' }}
            onFinish={async (values: { action: string; account?: string; key?: string }) => {
              const needsConfirm = values.action !== 'list' && values.action !== 'linkedaccounts'
              const exec = async () => {
                const resp = await api<{ result?: string; command?: string }>('/api/v1/playerbots/account', {
                  method: 'POST',
                  body: JSON.stringify({ ...values, confirm: true }),
                })
                setAccountResult(typeof resp.result === 'string' ? resp.result : JSON.stringify(resp))
              }
              if (!needsConfirm) {
                try {
                  await exec()
                  message.success(t('common.ok'))
                } catch (err) {
                  message.error(errorMessage(err, t))
                }
                return
              }
              setPending({
                title: t('playerbots.account'),
                description: t('playerbots.accountConfirm', { action: values.action }),
                run: exec,
              })
            }}
          >
            <Form.Item name="action" rules={[{ required: true }]}>
              <Select
                style={{ width: 160 }}
                optionLabelProp="label"
                options={[
                  { value: 'list', label: t('common.list'), title: t('playerbots.accountListHint') },
                  { value: 'link', label: t('playerbots.link'), title: t('playerbots.linkHint') },
                  { value: 'unlink', label: t('playerbots.unlink'), title: t('playerbots.unlinkHint') },
                  { value: 'setkey', label: t('playerbots.setKey'), title: t('playerbots.setKeyHint') },
                ]}
                optionRender={(opt) => (
                  <Tooltip placement="right" title={opt.data.title as string}>
                    <span>{opt.data.label as string}</span>
                  </Tooltip>
                )}
              />
            </Form.Item>
            <Form.Item noStyle shouldUpdate={(a, b) => a.action !== b.action}>
              {({ getFieldValue }) => {
                const action = getFieldValue('action') as string
                return (
                  <>
                    {(action === 'link' || action === 'unlink') && (
                      <Form.Item name="account" rules={[{ required: true }]}>
                        <Input placeholder={t('accounts.username')} />
                      </Form.Item>
                    )}
                    {(action === 'link' || action === 'setkey') && (
                      <Form.Item name="key" rules={[{ required: true }]} tooltip={t('playerbots.setKeyHint')}>
                        <Input placeholder={t('common.key')} />
                      </Form.Item>
                    )}
                  </>
                )
              }}
            </Form.Item>
            <Tooltip title={t('playerbots.accountHint')}>
              <Button htmlType="submit">{t('playerbots.account')}</Button>
            </Tooltip>
          </Form>
          {accountResult && (
            <Alert
              style={{ marginBottom: 16 }}
              type="success"
              message={t('playerbots.account')}
              description={<pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{accountResult}</pre>}
            />
          )}
        </>
      )}

      {stats && (
        <Alert
          style={{ marginBottom: 16 }}
          type="success"
          message={t('playerbots.stats')}
          description={<pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{stats}</pre>}
        />
      )}

      <Typography.Title level={5}>{t('playerbots.onlineList')}</Typography.Title>
      <Table
        rowKey="guid"
        dataSource={online}
        pagination={{ pageSize: 20 }}
        columns={[
          { title: t('characters.name'), dataIndex: 'name' },
          { title: t('characters.account'), dataIndex: 'account' },
          { title: t('characters.level'), dataIndex: 'level', width: 80 },
          {
            title: t('characters.map'),
            dataIndex: 'map',
            width: 140,
            render: (_: number, r: BotRow) => (r.map_name ? `${r.map_name} (#${r.map})` : r.map),
          },
          {
            title: t('common.class'),
            dataIndex: 'class',
            width: 120,
            render: (_: number, r: BotRow) => classLabel(r.class, i18n.language, r.class_name),
          },
        ]}
      />

      <Typography.Title level={5} style={{ marginTop: 24 }}>
        {t('playerbots.guilds')}
      </Typography.Title>
      <Table
        size="small"
        rowKey="id"
        dataSource={guilds}
        pagination={{ pageSize: 10 }}
        columns={[
          { title: 'ID', dataIndex: 'id', width: 80 },
          { title: t('guilds.name'), dataIndex: 'name' },
          { title: t('playerbots.botMembers'), dataIndex: 'bot_members', width: 120 },
        ]}
      />

      <Typography.Title level={5} style={{ marginTop: 24 }}>
        {t('playerbots.config')}
      </Typography.Title>
      {!config?.available ? (
        <Alert type="info" message={config?.message || t('playerbots.configMissing')} />
      ) : hasMinRole('superadmin') ? (
        <Form
          form={configForm}
          layout="vertical"
          style={{ maxWidth: 560 }}
          onFinish={(values: Record<string, string>) => {
            const updates: Record<string, string> = {}
            for (const k of CONFIG_KEYS) {
              if (values[k] != null && String(values[k]).trim() !== '') {
                updates[k] = String(values[k]).trim()
              }
            }
            setPending({
              title: t('playerbots.config'),
              description: t('playerbots.configConfirm'),
              run: async () => {
                await api('/api/v1/playerbots/config', {
                  method: 'PUT',
                  body: JSON.stringify({ values: updates, confirm: true, reload: true }),
                })
                await load()
              },
            })
          }}
        >
          {CONFIG_KEYS.map((key) => (
            <Form.Item key={key} name={key} label={key}>
              <Input />
            </Form.Item>
          ))}
          <Tooltip title={t('playerbots.configSaveHint')}>
            <Button type="primary" htmlType="submit">
              {t('playerbots.configSave')}
            </Button>
          </Tooltip>
        </Form>
      ) : (
        <Descriptions bordered size="small" column={1}>
          {Object.entries(config.values ?? {}).map(([k, v]) => (
            <Descriptions.Item key={k} label={k}>
              {v}
            </Descriptions.Item>
          ))}
        </Descriptions>
      )}

      <ConfirmDanger
        open={!!pending}
        title={pending?.title}
        description={pending?.description}
        onCancel={() => setPending(null)}
        onConfirm={async () => {
          if (!pending) return
          try {
            await pending.run()
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
