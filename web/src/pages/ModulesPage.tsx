import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { api, errorMessage, hasMinRole } from '../api/client'
import { ConfirmDanger } from '../components/ConfirmDanger'
import { DataTable, Modal, Tabs, toast, type Column } from '../ui'

type CatalogItem = {
  id: string
  full_name: string
  url: string
  description?: string
  stargazers_count?: number
  pushed_at?: string
  source: string
  name_zh?: string
  name_en?: string
  summary_zh?: string
  summary_en?: string
  known_risks_zh?: string
  known_risks_en?: string
}

type InstalledModule = {
  id: string
  dirname: string
  remote?: string
  owner_repo?: string
  branch?: string
  commit?: string
  commit_date?: string
  dirty?: boolean
  listed_in_modules_list?: boolean
  has_conf?: boolean
  conf_id?: string
  loaded?: boolean | null
  loaded_label?: string
}

type Inventory = {
  core: {
    version?: string
    revision?: string
    deploy?: string
    ac_root_writable?: boolean
    source?: string
  }
  items: InstalledModule[]
  paths: { modules_dir?: string; modules_dir_ok?: boolean; etc_modules_ok?: boolean }
}

type RegistryEntry = {
  id: string
  owner_repo: string
  url: string
  ref?: string
  has_acore_module_json?: boolean | null
}

function formatPushDate(iso?: string, locale = 'zh-CN'): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
  return d.toLocaleDateString(locale, { year: 'numeric', month: '2-digit', day: '2-digit' })
}

type Evaluation = {
  verdict: string
  compat_score: number
  ac_version_match: string
  version_note?: string
  features_zh?: string
  summary?: string
  needs_rebuild: boolean
  needs_sql: boolean
  needs_client_patch: boolean
  already_installed?: boolean
  inventory_ok?: boolean
  conflicts: string[]
  issue_findings: { number: number; severity: string; summary: string }[]
  risks: string[]
  steps: { title: string; command?: string; source?: string; phase?: string }[]
  missing_evidence: string[]
  citations: string[]
  degraded?: boolean
  degraded_reason?: string
  model_used?: boolean
  core_version?: string
  core_revision?: string
  latest_commit_date?: string
  module_id?: string
}

export function ModulesPage() {
  const { t, i18n } = useTranslation()
  const zh = i18n.language.startsWith('zh')
  const [tab, setTab] = useState('catalog')
  const [q, setQ] = useState('')
  const [catalog, setCatalog] = useState<CatalogItem[]>([])
  const [catalogWarn, setCatalogWarn] = useState('')
  const [inventory, setInventory] = useState<Inventory | null>(null)
  const [registry, setRegistry] = useState<RegistryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [evalResult, setEvalResult] = useState<{
    evaluation: Evaluation
    material: {
      owner_repo: string
      latest_commit?: string
      latest_commit_date?: string
      has_readme?: boolean
      has_acore_json?: boolean
      sql_paths?: string[]
      fetch_errors?: string[]
      rate_limited?: boolean
    }
    deepseek_configured?: boolean
    inventory_ok?: boolean
    fetch_warning?: string
  } | null>(null)
  const [evaluating, setEvaluating] = useState(false)
  const [registryURL, setRegistryURL] = useState('')
  const [pendingReg, setPendingReg] = useState(false)
  const [pendingDel, setPendingDel] = useState<string | null>(null)
  const [confContent, setConfContent] = useState<string | null>(null)
  const [confPath, setConfPath] = useState('')
  const [pendingConf, setPendingConf] = useState(false)

  const loadCatalog = useCallback(async () => {
    const data = await api<{ items: CatalogItem[]; catalogue_warning?: string }>(
      `/api/v1/modules/catalog?q=${encodeURIComponent(q)}`,
    )
    setCatalog(data.items)
    setCatalogWarn(data.catalogue_warning || '')
  }, [q])

  const loadInstalled = useCallback(async () => {
    const data = await api<Inventory>('/api/v1/modules/installed')
    setInventory(data)
  }, [])

  const loadRegistry = useCallback(async () => {
    const data = await api<{ items: RegistryEntry[] }>('/api/v1/modules/registry')
    setRegistry(data.items || [])
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      await Promise.all([loadCatalog(), loadInstalled(), loadRegistry()])
    } catch (err) {
      toast.error(errorMessage(err, t))
    } finally {
      setLoading(false)
    }
  }, [loadCatalog, loadInstalled, loadRegistry, t])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const [evalOpen, setEvalOpen] = useState(false)

  const runEvaluate = useCallback(
    async (id: string, force = false) => {
      setSelected(id)
      setEvalOpen(true)
      setEvaluating(true)
      setEvalResult(null)
      setConfContent(null)
      try {
        const data = await api<{
          evaluation: Evaluation
          material: {
            owner_repo: string
            latest_commit?: string
            latest_commit_date?: string
            has_readme?: boolean
            has_acore_json?: boolean
            sql_paths?: string[]
            fetch_errors?: string[]
            rate_limited?: boolean
          }
          deepseek_configured?: boolean
          inventory_ok?: boolean
          fetch_warning?: string
        }>(`/api/v1/modules/${encodeURIComponent(id)}/evaluate`, {
          method: 'POST',
          body: JSON.stringify({ force }),
        })
        setEvalResult(data)
      } catch (err) {
        toast.error(errorMessage(err, t))
        setEvalOpen(false)
      } finally {
        setEvaluating(false)
      }
    },
    [t],
  )

  const loadConf = useCallback(
    async (id: string) => {
      try {
        const data = await api<{ path: string; content: string }>(
          `/api/v1/modules/${encodeURIComponent(id)}/conf`,
        )
        setSelected(id)
        setConfPath(data.path)
        setConfContent(data.content)
      } catch (err) {
        toast.error(errorMessage(err, t))
      }
    },
    [t],
  )

  const closeEval = useCallback(() => {
    if (evaluating) return
    setEvalOpen(false)
  }, [evaluating])

  const installedKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const m of inventory?.items || []) {
      if (m.id) keys.add(m.id.toLowerCase())
      if (m.dirname) keys.add(m.dirname.toLowerCase())
      if (m.owner_repo) keys.add(m.owner_repo.toLowerCase())
    }
    return keys
  }, [inventory])

  const isInstalledRow = useCallback(
    (id?: string, fullName?: string) => {
      if (id && installedKeys.has(id.toLowerCase())) return true
      if (fullName && installedKeys.has(fullName.toLowerCase())) return true
      return false
    },
    [installedKeys],
  )

  const catalogColumns: Column<CatalogItem>[] = useMemo(
    () => [
      {
        key: 'name',
        title: t('modules.colName'),
        sorter: true,
        sortValue: (row) => (zh ? row.name_zh || row.id : row.name_en || row.id),
        render: (_v, row) => {
          const installed = isInstalledRow(row.id, row.full_name)
          return (
            <div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span>{zh ? row.name_zh || row.id : row.name_en || row.id}</span>
                {installed && (
                  <span className="badge badge-success badge-sm">{t('modules.installedBadge')}</span>
                )}
              </div>
              {(zh ? row.summary_zh : row.summary_en) && (
                <div className="text-xs text-base-content/50 line-clamp-1">
                  {zh ? row.summary_zh : row.summary_en}
                </div>
              )}
            </div>
          )
        },
      },
      {
        key: 'repo',
        title: t('modules.colRepo'),
        sorter: true,
        sortValue: (row) => row.full_name,
        render: (_v, row) => (
          <a className="link link-hover" href={row.url} target="_blank" rel="noreferrer">
            {row.full_name}
          </a>
        ),
      },
      {
        key: 'pushed',
        title: t('modules.colPushed'),
        sorter: true,
        sortValue: (row) => row.pushed_at || '',
        render: (_v, row) => (
          <span className="text-sm tabular-nums whitespace-nowrap">
            {formatPushDate(row.pushed_at, zh ? 'zh-CN' : 'en-US')}
          </span>
        ),
      },
      {
        key: 'stars',
        title: '★',
        sorter: true,
        dataIndex: 'stargazers_count',
        sortValue: (row) => row.stargazers_count ?? -1,
        render: (_v, row) => row.stargazers_count ?? '—',
      },
      {
        key: 'source',
        title: t('modules.colSource'),
        sorter: true,
        sortValue: (row) => row.source,
        render: (_v, row) => (
          <span className={`badge badge-sm ${row.source === 'curated' ? 'badge-primary' : 'badge-ghost'}`}>
            {row.source}
          </span>
        ),
      },
      {
        key: 'actions',
        title: t('common.actions'),
        render: (_v, row) => (
          <button type="button" className="btn btn-xs btn-primary" onClick={() => void runEvaluate(row.id)}>
            {t('modules.evaluate')}
          </button>
        ),
      },
    ],
    [t, zh, runEvaluate, isInstalledRow],
  )

  const installedColumns: Column<InstalledModule>[] = useMemo(
    () => [
      { key: 'id', title: 'ID', dataIndex: 'id', sorter: true },
      {
        key: 'branch',
        title: t('modules.colBranch'),
        sorter: true,
        sortValue: (r) => r.branch || '',
        render: (_v, r) => r.branch || '—',
      },
      {
        key: 'commit',
        title: 'Commit',
        sorter: true,
        sortValue: (r) => r.commit || '',
        render: (_v, r) => r.commit || '—',
      },
      {
        key: 'commit_date',
        title: t('modules.colPushed'),
        sorter: true,
        sortValue: (r) => r.commit_date || '',
        render: (_v, r) => (
          <span className="text-sm tabular-nums whitespace-nowrap">
            {formatPushDate(r.commit_date, zh ? 'zh-CN' : 'en-US')}
          </span>
        ),
      },
      {
        key: 'loaded',
        title: t('modules.colLoaded'),
        sorter: true,
        sortValue: (r) => (r.loaded == null ? -1 : r.loaded ? 1 : 0),
        render: (_v, r) =>
          r.loaded == null ? '—' : r.loaded ? (
            <span className="badge badge-success badge-sm">{t('common.yes')}</span>
          ) : (
            <span className="badge badge-ghost badge-sm">{t('common.no')}</span>
          ),
      },
      {
        key: 'actions',
        title: t('common.actions'),
        render: (_v, r) => (
          <div className="flex gap-1">
            <button type="button" className="btn btn-xs" onClick={() => void runEvaluate(r.id)}>
              {t('modules.evaluate')}
            </button>
            {r.has_conf && hasMinRole('superadmin') && (
              <button type="button" className="btn btn-xs" onClick={() => void loadConf(r.id)}>
                {t('modules.conf')}
              </button>
            )}
          </div>
        ),
      },
    ],
    [t, zh, runEvaluate, loadConf],
  )

  const verdictClass = (v: string) => {
    if (v === 'ok') return 'badge-success'
    if (v === 'no') return 'badge-error'
    return 'badge-warning'
  }

  const verdictLabel = (v: string) => {
    if (v === 'ok') return t('modules.verdictOk')
    if (v === 'no') return t('modules.verdictNo')
    return t('modules.verdictCaution')
  }

  const versionMatchLabel = (v: string) => {
    if (v === 'match') return t('modules.versionMatchOk')
    if (v === 'mismatch') return t('modules.versionMismatch')
    return t('modules.versionUnknown')
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div>
          <h1 className="text-2xl font-semibold m-0">{t('pages.modules.title')}</h1>
          <p className="text-sm text-base-content/60 m-0 mt-1">{t('modules.subtitle')}</p>
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
            key: 'catalog',
            label: t('modules.tabCatalog'),
            children: (
              <div>
                <div className="flex gap-2 mb-3">
                  <input
                    className="input input-bordered input-sm flex-1 max-w-md"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder={t('modules.searchPlaceholder')}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void loadCatalog().catch((err) => toast.error(errorMessage(err, t)))
                    }}
                  />
                  <button type="button" className="btn btn-sm" onClick={() => void loadCatalog()}>
                    {t('common.search')}
                  </button>
                </div>
                {catalogWarn && <p className="text-warning text-sm mb-2">{catalogWarn}</p>}
                <DataTable
                  columns={catalogColumns}
                  dataSource={catalog}
                  rowKey={(r) => r.full_name || r.id}
                  defaultSortKey="stars"
                  defaultSortDir="desc"
                />
              </div>
            ),
          },
          {
            key: 'installed',
            label: t('modules.tabInstalled'),
            children: (
              <DataTable
                columns={installedColumns}
                dataSource={inventory?.items || []}
                rowKey={(r) => r.id}
                defaultSortKey="commit_date"
                defaultSortDir="desc"
              />
            ),
          },
          {
            key: 'registry',
            label: t('modules.tabRegistry'),
            children: (
              <div>
                {hasMinRole('superadmin') && (
                  <div className="flex flex-wrap gap-2 mb-3">
                    <input
                      className="input input-bordered input-sm flex-1 min-w-[240px]"
                      value={registryURL}
                      onChange={(e) => setRegistryURL(e.target.value)}
                      placeholder="owner/repo 或 https://github.com/owner/repo"
                    />
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => setPendingReg(true)}>
                      {t('modules.addRegistry')}
                    </button>
                  </div>
                )}
                <ul className="menu bg-base-200 rounded-box">
                  {registry.length === 0 && <li className="disabled"><span>{t('modules.emptyRegistry')}</span></li>}
                  {registry.map((r) => (
                    <li key={r.id} className="flex flex-row items-center gap-2 px-2">
                      <button type="button" className="flex-1 text-left" onClick={() => void runEvaluate(r.id)}>
                        <span className="font-medium inline-flex items-center gap-1.5">
                          {r.id}
                          {isInstalledRow(r.id, r.owner_repo) && (
                            <span className="badge badge-success badge-sm">{t('modules.installedBadge')}</span>
                          )}
                        </span>
                        <span className="text-xs opacity-60">{r.owner_repo}</span>
                      </button>
                      {hasMinRole('superadmin') && (
                        <button type="button" className="btn btn-ghost btn-xs" onClick={() => setPendingDel(r.id)}>
                          {t('common.remove')}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ),
          },
        ]}
      />

      <Modal
        open={evalOpen}
        title={`${t('modules.evalTitle')}${selected ? ` · ${selected}` : ''}`}
        onClose={closeEval}
        className="max-w-xl"
        footer={
          <div className="flex justify-end gap-2 mt-6">
            {selected && (
              <button
                type="button"
                className="btn"
                disabled={evaluating}
                onClick={() => void runEvaluate(selected, true)}
              >
                {evaluating && <span className="loading loading-spinner loading-sm" />}
                {t('modules.reevaluate')}
              </button>
            )}
            <button type="button" className="btn btn-primary" onClick={closeEval} disabled={evaluating}>
              {t('common.ok')}
            </button>
          </div>
        }
      >
        {evaluating && !evalResult && (
          <div className="flex items-center gap-3 py-10 justify-center text-sm text-base-content/70">
            <span className="loading loading-spinner loading-md" />
            {t('modules.evaluating')}
          </div>
        )}
        {evalResult && (() => {
          const ev = evalResult.evaluation
          const score = Math.max(0, Math.min(100, ev.compat_score || 0))
          const scoreColor =
            score >= 75 ? 'text-success' : score >= 40 ? 'text-warning' : 'text-error'
          const barColor =
            score >= 75 ? 'bg-success' : score >= 40 ? 'bg-warning' : 'bg-error'
          return (
            <div className="space-y-4">
              <div className="flex items-start gap-4">
                <div className="shrink-0 text-center w-20">
                  <div className={`text-3xl font-semibold leading-none tabular-nums ${scoreColor}`}>
                    {score}
                  </div>
                  <div className="text-[11px] uppercase tracking-wide text-base-content/50 mt-1">
                    {t('modules.compat')}
                  </div>
                </div>
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex flex-wrap gap-1.5 items-center">
                    <span className={`badge ${verdictClass(ev.verdict)}`}>{verdictLabel(ev.verdict)}</span>
                    <span className="badge badge-ghost badge-sm">
                      {t('modules.versionMatch')}: {versionMatchLabel(ev.ac_version_match)}
                    </span>
                    {(ev.already_installed || isInstalledRow(ev.module_id || selected || undefined, evalResult.material.owner_repo)) && (
                      <span className="badge badge-success badge-sm">{t('modules.alreadyInstalled')}</span>
                    )}
                    {ev.degraded && (
                      <span className="badge badge-warning badge-sm">{t('modules.degraded')}</span>
                    )}
                  </div>
                  {(ev.inventory_ok === false || evalResult.inventory_ok === false) && (
                    <p className="text-xs text-warning m-0">{t('modules.inventoryPartial')}</p>
                  )}
                  <div className="h-1.5 w-full rounded-full bg-base-300 overflow-hidden">
                    <div className={`h-full ${barColor}`} style={{ width: `${score}%` }} />
                  </div>
                  <div className="text-xs text-base-content/55 flex flex-wrap gap-x-3 gap-y-1">
                    {(ev.core_version || ev.core_revision) && (
                      <span>
                        {t('modules.core')}: {ev.core_version || ev.core_revision}
                        {ev.core_version && ev.core_revision ? ` (${ev.core_revision})` : ''}
                      </span>
                    )}
                    {(ev.latest_commit_date || evalResult.material.latest_commit_date) && (
                      <span>
                        {t('modules.colPushed')}:{' '}
                        {formatPushDate(
                          ev.latest_commit_date || evalResult.material.latest_commit_date,
                          zh ? 'zh-CN' : 'en-US',
                        )}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {ev.features_zh && (
                <section>
                  <h3 className="text-xs font-medium uppercase tracking-wide text-base-content/50 m-0 mb-1.5">
                    {t('modules.features')}
                  </h3>
                  <p className="text-sm leading-relaxed m-0">{ev.features_zh}</p>
                </section>
              )}

              {ev.summary && (
                <section className="rounded-lg border border-base-300 bg-base-200/60 px-3 py-2.5">
                  <h3 className="text-xs font-medium uppercase tracking-wide text-base-content/50 m-0 mb-1.5">
                    {t('modules.advice')}
                  </h3>
                  <p className="text-sm leading-relaxed m-0 whitespace-pre-wrap">{ev.summary}</p>
                </section>
              )}

              <section>
                <h3 className="text-xs font-medium uppercase tracking-wide text-base-content/50 m-0 mb-1.5">
                  {t('modules.flags')}
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {ev.needs_rebuild && (
                    <span className="badge badge-sm">{t('modules.needsRebuild')}</span>
                  )}
                  {ev.needs_sql && (
                    <span className="badge badge-sm badge-warning badge-outline">{t('modules.needsSQL')}</span>
                  )}
                  {ev.needs_client_patch && (
                    <span className="badge badge-sm badge-error badge-outline">
                      {t('modules.needsClientPatch')}
                    </span>
                  )}
                  {!ev.needs_rebuild && !ev.needs_sql && !ev.needs_client_patch && (
                    <span className="text-sm text-base-content/50">—</span>
                  )}
                </div>
              </section>

              {ev.version_note && (
                <p className="text-xs text-base-content/60 m-0 leading-relaxed">{ev.version_note}</p>
              )}
              {ev.degraded_reason && (
                <p className="text-xs text-warning m-0">
                  {t('modules.degradedReason')}: {ev.degraded_reason}
                </p>
              )}
              {evalResult.fetch_warning && (
                <p className="text-warning text-xs m-0">{evalResult.fetch_warning}</p>
              )}

              {ev.risks?.length > 0 && (
                <section>
                  <h3 className="text-xs font-medium uppercase tracking-wide text-base-content/50 m-0 mb-1.5">
                    {t('modules.risks')}
                  </h3>
                  <ul className="m-0 pl-4 text-sm space-y-1 list-disc marker:text-base-content/40">
                    {ev.risks.slice(0, 6).map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </section>
              )}

              {ev.conflicts?.length > 0 && (
                <section>
                  <h3 className="text-xs font-medium uppercase tracking-wide text-base-content/50 m-0 mb-1.5">
                    {t('modules.conflicts')}
                  </h3>
                  <ul className="m-0 pl-4 text-sm space-y-1 list-disc marker:text-base-content/40">
                    {ev.conflicts.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </section>
              )}

              <p className="text-xs text-base-content/45 m-0 pt-1 border-t border-base-300">
                {t('modules.aiDisclaimer')}{' '}
                {t('modules.installHint')}{' '}
                <Link className="link" to="/config" onClick={closeEval}>
                  {t('nav.config')}
                </Link>
              </p>
            </div>
          )
        })()}
      </Modal>

      {confContent != null && hasMinRole('superadmin') && (
        <div className="mt-4 border border-base-300 rounded-box p-4">
          <h3 className="font-medium mb-2">
            {t('modules.conf')} · {confPath}
          </h3>
          <textarea
            className="textarea textarea-bordered w-full font-mono text-xs h-64"
            value={confContent}
            onChange={(e) => setConfContent(e.target.value)}
          />
          <div className="mt-2">
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setPendingConf(true)}>
              {t('common.save')}
            </button>
          </div>
        </div>
      )}

      <ConfirmDanger
        open={pendingReg}
        title={t('modules.addRegistry')}
        description={registryURL}
        onCancel={() => setPendingReg(false)}
        onConfirm={async () => {
          setPendingReg(false)
          try {
            await api('/api/v1/modules/registry', {
              method: 'POST',
              body: JSON.stringify({ url: registryURL, confirm: true }),
            })
            setRegistryURL('')
            toast.success(t('common.success'))
            await loadRegistry()
          } catch (err) {
            toast.error(errorMessage(err, t))
          }
        }}
      />
      <ConfirmDanger
        open={!!pendingDel}
        title={t('common.remove')}
        description={pendingDel || ''}
        onCancel={() => setPendingDel(null)}
        onConfirm={async () => {
          const id = pendingDel
          setPendingDel(null)
          if (!id) return
          try {
            await api(`/api/v1/modules/registry/${encodeURIComponent(id)}`, {
              method: 'DELETE',
              body: JSON.stringify({ confirm: true }),
            })
            toast.success(t('common.success'))
            await loadRegistry()
          } catch (err) {
            toast.error(errorMessage(err, t))
          }
        }}
      />
      <ConfirmDanger
        open={pendingConf}
        title={t('modules.saveConf')}
        description={confPath}
        onCancel={() => setPendingConf(false)}
        onConfirm={async () => {
          setPendingConf(false)
          if (!selected || confContent == null) return
          try {
            await api(`/api/v1/modules/${encodeURIComponent(selected)}/conf`, {
              method: 'PUT',
              body: JSON.stringify({ content: confContent, confirm: true, reload: true }),
            })
            toast.success(t('common.success'))
          } catch (err) {
            toast.error(errorMessage(err, t))
          }
        }}
      />
    </div>
  )
}
