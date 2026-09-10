import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { api, errorMessage, getTargetId, hasMinRole, setTargetId } from '../api/client'
import { ConfirmDanger } from '../components/ConfirmDanger'
import { MapSelect, TeleSelect } from '../components/PlaceSelect'
import { Select, Tabs, toast } from '../ui'

type Target = { id: string; name: string; docker_enabled: boolean }

type Pending =
  | { kind: 'soap'; cmd: string }
  | {
      kind: 'teleAdd'
      payload: { name: string; map: number; x: number; y: number; z: number; orientation: number }
    }
  | { kind: 'teleDel'; name: string }

const RELOAD_TABLES = ['config', 'loot', 'quest', 'creature', 'motd', 'tele', 'item', 'spell', 'all']

function HintLabel({ children, tip }: { children: ReactNode; tip: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {children}
      <span className="tooltip tooltip-bottom" data-tip={tip}>
        <span className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-base-content/30 text-[10px] leading-none opacity-60 cursor-help">
          ?
        </span>
      </span>
    </span>
  )
}

export function SettingsPage() {
  const { t } = useTranslation()
  const [tab, setTab] = useState('target')
  const [targets, setTargets] = useState<Target[]>([])
  const [target, setTarget] = useState(getTargetId())
  const [pending, setPending] = useState<Pending | null>(null)
  const [result, setResult] = useState('')

  const [reloadTable, setReloadTable] = useState('config')
  const [teleName, setTeleName] = useState('')
  const [teleMap, setTeleMap] = useState<number | undefined>(undefined)
  const [teleX, setTeleX] = useState('')
  const [teleY, setTeleY] = useState('')
  const [teleZ, setTeleZ] = useState('')
  const [teleOrientation, setTeleOrientation] = useState('0')
  const [teleDelName, setTeleDelName] = useState('')
  const [command, setCommand] = useState('')

  useEffect(() => {
    void api<{ items: Target[] }>('/api/v1/targets')
      .then((d) => {
        setTargets(d.items)
        if (!getTargetId() && d.items[0]) {
          setTargetId(d.items[0].id)
          setTarget(d.items[0].id)
        }
      })
      .catch((err) => toast.error(errorMessage(err, t)))
  }, [t])

  const resetTeleAdd = () => {
    setTeleName('')
    setTeleMap(undefined)
    setTeleX('')
    setTeleY('')
    setTeleZ('')
    setTeleOrientation('0')
  }

  return (
    <div className="max-w-[880px]">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold m-0">{t('pages.settings.title')}</h1>
        <p className="text-sm text-base-content/60 m-0 mt-1">{t('settings.subtitle')}</p>
      </div>

      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: 'target',
            label: <HintLabel tip={t('settings.targetHint')}>{t('settings.target')}</HintLabel>,
            children: (
              <div className="space-y-3 max-w-md">
                <p className="text-sm text-base-content/60 m-0">{t('settings.targetDesc')}</p>
                <Select
                  value={target || undefined}
                  options={targets.map((x) => ({ value: x.id, label: `${x.name} (${x.id})` }))}
                  onChange={(v) => {
                    if (!v) return
                    setTargetId(v)
                    setTarget(v)
                    toast.success(t('settings.targetSwitched'))
                  }}
                />
              </div>
            ),
          },
          {
            key: 'reload',
            label: <HintLabel tip={t('settings.reloadHint')}>{t('settings.reload')}</HintLabel>,
            children: (
              <div className="space-y-3">
                <p className="text-sm text-base-content/60 m-0">{t('settings.reloadDesc')}</p>
                <form
                  className="flex flex-wrap items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (!reloadTable) {
                      toast.error(t('validation.required'))
                      return
                    }
                    setPending({ kind: 'soap', cmd: `reload ${reloadTable}` })
                  }}
                >
                  <div className="w-40">
                    <Select
                      value={reloadTable}
                      onChange={(v) => setReloadTable(v ?? '')}
                      options={RELOAD_TABLES.map((v) => ({
                        value: v,
                        label: t(`settings.reloadTable.${v}`, { defaultValue: v }),
                      }))}
                    />
                  </div>
                  <span className="tooltip" data-tip={t('settings.doReloadHint')}>
                    <button type="submit" className="btn btn-sm btn-primary">
                      {t('settings.doReload')}
                    </button>
                  </span>
                </form>
                {result && tab === 'reload' && (
                  <pre className="mt-2 bg-neutral text-neutral-content p-3 whitespace-pre-wrap rounded-md text-xs">
                    {result}
                  </pre>
                )}
              </div>
            ),
          },
          ...(hasMinRole('gm')
            ? [
                {
                  key: 'tele',
                  label: <HintLabel tip={t('settings.teleHint')}>{t('settings.teleManage')}</HintLabel>,
                  children: (
                    <div className="space-y-4">
                      <p className="text-sm text-base-content/60 m-0">{t('settings.teleDesc')}</p>
                      <div>
                        <h3 className="text-sm font-medium mb-2">
                          <HintLabel tip={t('settings.teleAddHint')}>{t('settings.teleAdd')}</HintLabel>
                        </h3>
                        <form
                          className="flex flex-wrap items-center gap-2"
                          onSubmit={(e) => {
                            e.preventDefault()
                            if (
                              !teleName.trim() ||
                              teleMap == null ||
                              teleX === '' ||
                              teleY === '' ||
                              teleZ === ''
                            ) {
                              toast.error(t('validation.required'))
                              return
                            }
                            setPending({
                              kind: 'teleAdd',
                              payload: {
                                name: teleName,
                                map: teleMap,
                                x: Number(teleX),
                                y: Number(teleY),
                                z: Number(teleZ),
                                orientation: teleOrientation === '' ? 0 : Number(teleOrientation),
                              },
                            })
                          }}
                        >
                          <input
                            className="input input-bordered input-sm w-32"
                            placeholder={t('characters.name')}
                            value={teleName}
                            onChange={(e) => setTeleName(e.target.value)}
                          />
                          <MapSelect className="w-56" value={teleMap} onChange={(v) => setTeleMap(v ?? undefined)} />
                          <input
                            type="number"
                            className="input input-bordered input-sm w-24"
                            placeholder={t('settings.coordX')}
                            value={teleX}
                            onChange={(e) => setTeleX(e.target.value)}
                          />
                          <input
                            type="number"
                            className="input input-bordered input-sm w-24"
                            placeholder={t('settings.coordY')}
                            value={teleY}
                            onChange={(e) => setTeleY(e.target.value)}
                          />
                          <input
                            type="number"
                            className="input input-bordered input-sm w-24"
                            placeholder={t('settings.coordZ')}
                            value={teleZ}
                            onChange={(e) => setTeleZ(e.target.value)}
                          />
                          <input
                            type="number"
                            className="input input-bordered input-sm w-24"
                            placeholder={t('settings.orientation')}
                            value={teleOrientation}
                            onChange={(e) => setTeleOrientation(e.target.value)}
                          />
                          <button type="submit" className="btn btn-sm btn-primary">
                            {t('settings.teleAdd')}
                          </button>
                        </form>
                      </div>
                      <div>
                        <h3 className="text-sm font-medium mb-2">
                          <HintLabel tip={t('settings.teleDelHint')}>{t('settings.teleDel')}</HintLabel>
                        </h3>
                        <form
                          className="flex flex-wrap items-center gap-2"
                          onSubmit={(e) => {
                            e.preventDefault()
                            if (!teleDelName) {
                              toast.error(t('validation.required'))
                              return
                            }
                            setPending({ kind: 'teleDel', name: teleDelName })
                          }}
                        >
                          <TeleSelect className="w-72" value={teleDelName} onChange={(v) => setTeleDelName(v ?? '')} />
                          <button type="submit" className="btn btn-sm btn-error">
                            {t('settings.teleDel')}
                          </button>
                        </form>
                      </div>
                    </div>
                  ),
                },
              ]
            : []),
          {
            key: 'soap',
            label: <HintLabel tip={t('settings.soapTabHint')}>{t('settings.soap')}</HintLabel>,
            children: (
              <div className="space-y-3">
                <div className="alert alert-warning text-sm py-2">{t('settings.soapHint')}</div>
                <p className="text-sm text-base-content/60 m-0">{t('settings.soapDesc')}</p>
                <form
                  className="flex flex-col gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (!command.trim()) {
                      toast.error(t('validation.required'))
                      return
                    }
                    setPending({ kind: 'soap', cmd: command })
                  }}
                >
                  <label className="form-control w-full">
                    <span className="label-text mb-1">
                      <HintLabel tip={t('settings.commandHint')}>{t('settings.command')}</HintLabel>
                    </span>
                    <textarea
                      className="textarea textarea-bordered w-full"
                      rows={3}
                      placeholder={t('settings.soapPlaceholder')}
                      value={command}
                      onChange={(e) => setCommand(e.target.value)}
                    />
                  </label>
                  <div>
                    <span className="tooltip" data-tip={t('settings.execHint')}>
                      <button type="submit" className="btn btn-sm btn-primary">
                        {t('settings.exec')}
                      </button>
                    </span>
                  </div>
                </form>
                {result && (
                  <pre className="mt-2 bg-neutral text-neutral-content p-3 whitespace-pre-wrap rounded-md text-xs">
                    {result}
                  </pre>
                )}
              </div>
            ),
          },
        ]}
      />

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
              resetTeleAdd()
            } else {
              await api(`/api/v1/teleports/${encodeURIComponent(pending.name)}`, {
                method: 'DELETE',
                body: JSON.stringify({ confirm: true }),
              })
              setTeleDelName('')
            }
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
