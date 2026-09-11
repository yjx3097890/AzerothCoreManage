import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { api, errorMessage, hasMinRole } from '../api/client'
import { ConfirmDanger } from '../components/ConfirmDanger'
import { DataTable, Select, Tabs, toast, type Column } from '../ui'

type Status = {
  configured: boolean
  enabled: boolean
  host: string
  port: number
  has_token: boolean
  health?: { ok?: boolean; service?: string; version?: string; error?: string } | null
  health_status?: number
}

type CharacterSnap = {
  ok?: boolean
  online?: boolean
  guid?: number
  accountId?: number
  name?: string
  selfbot?: boolean
  map?: number
  zone?: number
  x?: number
  y?: number
  z?: number
  o?: number
  level?: number
  class?: number
  hp?: [number, number]
  power?: [number, number]
  job?: Job | null
  latencyMs?: number
}

type JobStep = {
  op?: string
  detail?: string
  result?: string
  status?: string
}

type Job = {
  id?: string
  jobId?: string
  status?: string
  type?: string
  steps?: JobStep[]
  error?: string
}

type EventRow = {
  id: number
  jobId?: string
  kind: string
  message?: string
  createdAt?: number
}

type Patrol = {
  id: string
  name?: string
  waypoints?: { x: number; y: number; z: number; wait?: number }[]
  accountId?: number
}

type JobType = 'move_to' | 'complete_quest' | 'patrol' | 'script'

function PanelIntro({ children }: { children: ReactNode }) {
  return <p className="text-sm text-base-content/65 m-0 mb-4 leading-relaxed max-w-3xl">{children}</p>
}

function StatCard({ title, desc, value }: { title: string; desc: string; value: string | number }) {
  return (
    <div className="card bg-base-100 border border-base-300">
      <div className="card-body p-4 gap-1">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-base-content/55 leading-relaxed">{desc}</span>
        <span className="text-2xl font-semibold mt-1">{value}</span>
      </div>
    </div>
  )
}

function fmtCoord(n?: number) {
  return n == null || Number.isNaN(n) ? '-' : n.toFixed(1)
}

export function MyBotsPage() {
  const { t } = useTranslation()
  const gm = hasMinRole('gm')
  const [tab, setTab] = useState('overview')
  const [status, setStatus] = useState<Status | null>(null)
  const [charId, setCharId] = useState('')
  const [activeChar, setActiveChar] = useState('')
  const [snap, setSnap] = useState<CharacterSnap | null>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  const [jobDetail, setJobDetail] = useState<Job | null>(null)
  const [events, setEvents] = useState<EventRow[]>([])
  const [patrols, setPatrols] = useState<Patrol[]>([])
  const [pending, setPending] = useState<{ title: string; description: string; run: () => Promise<void> } | null>(
    null,
  )

  const [jobType, setJobType] = useState<JobType>('move_to')
  const [moveMode, setMoveMode] = useState<'xyz' | 'entry'>('xyz')
  const [moveX, setMoveX] = useState('')
  const [moveY, setMoveY] = useState('')
  const [moveZ, setMoveZ] = useState('')
  const [moveDist, setMoveDist] = useState('2.5')
  const [moveEntry, setMoveEntry] = useState('')
  const [questId, setQuestId] = useState('')
  const [giverEntry, setGiverEntry] = useState('')
  const [turninEntry, setTurninEntry] = useState('')
  const [patrolId, setPatrolId] = useState('')
  const [scriptSteps, setScriptSteps] = useState(
    '[\n  {"op":"wait","detail":"{\\"seconds\\":3}"}\n]',
  )
  const [replaceJob, setReplaceJob] = useState(true)

  const [patrolFormId, setPatrolFormId] = useState('')
  const [patrolFormName, setPatrolFormName] = useState('')
  const [patrolFormWaypoints, setPatrolFormWaypoints] = useState(
    '[\n  {"x":-8895,"y":-133,"z":80,"wait":2},\n  {"x":-8949,"y":-132,"z":83,"wait":2}\n]',
  )

  const loadStatus = useCallback(async () => {
    try {
      const data = await api<Status>('/api/v1/mybots/status')
      setStatus(data)
    } catch (err) {
      toast.error(errorMessage(err, t))
    }
  }, [t])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  const loadCharacter = async (id: string) => {
    const key = id.trim()
    if (!key) return
    try {
      const data = await api<CharacterSnap>(`/api/v1/mybots/characters/${encodeURIComponent(key)}`)
      setSnap(data)
      setActiveChar(key)
      setCharId(key)
    } catch (err) {
      setSnap(null)
      toast.error(errorMessage(err, t))
    }
  }

  const loadJobs = async (id: string) => {
    const key = id.trim()
    if (!key) return
    try {
      const data = await api<{ jobs?: Job[]; items?: Job[]; ok?: boolean }>(
        `/api/v1/mybots/characters/${encodeURIComponent(key)}/jobs`,
      )
      const list = data.jobs ?? data.items ?? (Array.isArray(data) ? (data as unknown as Job[]) : [])
      setJobs(Array.isArray(list) ? list : [])
    } catch (err) {
      setJobs([])
      toast.error(errorMessage(err, t))
    }
  }

  const loadEvents = async (id: string) => {
    const key = id.trim()
    if (!key) return
    try {
      const data = await api<{ events?: EventRow[] }>(
        `/api/v1/mybots/characters/${encodeURIComponent(key)}/events`,
      )
      setEvents(data.events ?? [])
    } catch (err) {
      setEvents([])
      toast.error(errorMessage(err, t))
    }
  }

  const loadPatrols = async () => {
    try {
      const data = await api<{ patrols?: Patrol[]; items?: Patrol[] }>('/api/v1/mybots/patrols')
      setPatrols(data.patrols ?? data.items ?? [])
    } catch (err) {
      setPatrols([])
      toast.error(errorMessage(err, t))
    }
  }

  const refreshCharRelated = async (id = activeChar) => {
    if (!id) return
    await Promise.all([loadCharacter(id), loadJobs(id), loadEvents(id)])
  }

  const setSelfbot = (enabled: boolean) => {
    if (!activeChar || !gm) return
    const run = async () => {
      await api(`/api/v1/mybots/characters/${encodeURIComponent(activeChar)}/selfbot`, {
        method: 'POST',
        body: JSON.stringify({ enabled }),
      })
      await loadCharacter(activeChar)
    }
    setPending({
      title: enabled ? t('mybots.enableSelfbot') : t('mybots.disableSelfbot'),
      description: t('mybots.selfbotConfirm', { name: activeChar, state: enabled ? 'on' : 'off' }),
      run,
    })
  }

  const buildJobBody = (): Record<string, unknown> | null => {
    const body: Record<string, unknown> = { type: jobType, replace: replaceJob }
    if (jobType === 'move_to') {
      if (moveMode === 'entry') {
        const entry = Number(moveEntry)
        if (!entry) {
          toast.error(t('mybots.needEntry'))
          return null
        }
        body.entry = entry
      } else {
        const x = Number(moveX)
        const y = Number(moveY)
        const z = Number(moveZ)
        if ([x, y, z].some((n) => Number.isNaN(n))) {
          toast.error(t('mybots.needXYZ'))
          return null
        }
        body.x = x
        body.y = y
        body.z = z
        if (moveDist) body.dist = Number(moveDist)
      }
    } else if (jobType === 'complete_quest') {
      const qid = Number(questId)
      if (!qid) {
        toast.error(t('mybots.needQuestId'))
        return null
      }
      body.questId = qid
      if (giverEntry) body.giverEntry = Number(giverEntry)
      if (turninEntry) body.turninEntry = Number(turninEntry)
    } else if (jobType === 'patrol') {
      if (!patrolId.trim()) {
        toast.error(t('mybots.needPatrolId'))
        return null
      }
      body.patrolId = patrolId.trim()
    } else if (jobType === 'script') {
      try {
        body.steps = JSON.parse(scriptSteps) as unknown[]
      } catch {
        toast.error(t('mybots.badScriptJson'))
        return null
      }
    }
    return body
  }

  const createJob = async () => {
    if (!activeChar || !gm) return
    const body = buildJobBody()
    if (!body) return
    try {
      await api(`/api/v1/mybots/characters/${encodeURIComponent(activeChar)}/jobs`, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      toast.success(t('common.ok'))
      await refreshCharRelated()
      setTab('jobs')
    } catch (err) {
      toast.error(errorMessage(err, t))
    }
  }

  const jobAction = (jobId: string, action: 'pause' | 'resume' | 'cancel') => {
    if (!activeChar || !gm || !jobId) return
    const run = async () => {
      const base = `/api/v1/mybots/characters/${encodeURIComponent(activeChar)}/jobs/${encodeURIComponent(jobId)}`
      if (action === 'cancel') {
        await api(base, { method: 'DELETE' })
      } else {
        await api(`${base}/${action}`, { method: 'POST' })
      }
      await refreshCharRelated()
      setJobDetail(null)
    }
    if (action === 'cancel') {
      setPending({
        title: t('mybots.cancelJob'),
        description: t('mybots.cancelJobConfirm', { id: jobId }),
        run,
      })
      return
    }
    void run()
      .then(() => toast.success(t('common.ok')))
      .catch((err) => toast.error(errorMessage(err, t)))
  }

  const cancelAllJobs = () => {
    if (!activeChar || !gm) return
    setPending({
      title: t('mybots.cancelAllJobs'),
      description: t('mybots.cancelAllJobsConfirm', { name: activeChar }),
      run: async () => {
        await api(`/api/v1/mybots/characters/${encodeURIComponent(activeChar)}/jobs`, { method: 'DELETE' })
        await refreshCharRelated()
      },
    })
  }

  const openJobDetail = async (jobId: string) => {
    if (!activeChar || !jobId) return
    try {
      const data = await api<Job>(
        `/api/v1/mybots/characters/${encodeURIComponent(activeChar)}/jobs/${encodeURIComponent(jobId)}`,
      )
      setJobDetail(data)
    } catch (err) {
      toast.error(errorMessage(err, t))
    }
  }

  const savePatrol = async () => {
    if (!gm) return
    if (!patrolFormId.trim()) {
      toast.error(t('mybots.needPatrolId'))
      return
    }
    let waypoints: unknown
    try {
      waypoints = JSON.parse(patrolFormWaypoints)
    } catch {
      toast.error(t('mybots.badWaypointJson'))
      return
    }
    try {
      await api('/api/v1/mybots/patrols', {
        method: 'POST',
        body: JSON.stringify({
          id: patrolFormId.trim(),
          name: patrolFormName.trim() || patrolFormId.trim(),
          waypoints,
          accountId: 0,
        }),
      })
      toast.success(t('common.ok'))
      await loadPatrols()
    } catch (err) {
      toast.error(errorMessage(err, t))
    }
  }

  useEffect(() => {
    if (tab === 'patrols' && status?.configured) void loadPatrols()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, status?.configured])

  const jobColumns: Column<Job>[] = [
    {
      key: 'id',
      title: 'ID',
      render: (_v, r) => r.id ?? r.jobId ?? '-',
    },
    { key: 'type', title: t('mybots.jobType'), dataIndex: 'type', width: 120 },
    { key: 'status', title: t('mybots.jobStatus'), dataIndex: 'status', width: 110 },
    {
      key: 'error',
      title: t('mybots.error'),
      render: (_v, r) => r.error || '-',
    },
    {
      key: 'actions',
      title: t('common.actions'),
      width: 220,
      render: (_v, r) => {
        const id = r.id ?? r.jobId ?? ''
        return (
          <div className="flex flex-wrap gap-1">
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => void openJobDetail(id)}>
              {t('mybots.detail')}
            </button>
            {gm && (
              <>
                <button type="button" className="btn btn-ghost btn-xs" onClick={() => jobAction(id, 'pause')}>
                  {t('mybots.pause')}
                </button>
                <button type="button" className="btn btn-ghost btn-xs" onClick={() => jobAction(id, 'resume')}>
                  {t('mybots.resume')}
                </button>
                <button type="button" className="btn btn-ghost btn-xs text-error" onClick={() => jobAction(id, 'cancel')}>
                  {t('confirm.cancel')}
                </button>
              </>
            )}
          </div>
        )
      },
    },
  ]

  const eventColumns: Column<EventRow>[] = [
    { key: 'id', title: 'ID', dataIndex: 'id', width: 70 },
    { key: 'kind', title: t('mybots.eventKind'), dataIndex: 'kind', width: 140 },
    { key: 'message', title: t('mybots.eventMessage'), dataIndex: 'message' },
    { key: 'jobId', title: 'Job', dataIndex: 'jobId', width: 140 },
    {
      key: 'createdAt',
      title: t('mybots.time'),
      width: 160,
      render: (_v, r) => (r.createdAt ? new Date(r.createdAt * 1000).toLocaleString() : '-'),
    },
  ]

  const patrolColumns: Column<Patrol>[] = [
    { key: 'id', title: 'ID', dataIndex: 'id', width: 160 },
    { key: 'name', title: t('mybots.patrolName'), dataIndex: 'name' },
    {
      key: 'waypoints',
      title: t('mybots.waypoints'),
      width: 100,
      render: (_v, r) => r.waypoints?.length ?? 0,
    },
    {
      key: 'use',
      title: t('common.actions'),
      width: 100,
      render: (_v, r) => (
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          onClick={() => {
            setPatrolId(r.id)
            setJobType('patrol')
            setTab('jobs')
          }}
        >
          {t('mybots.usePatrol')}
        </button>
      ),
    },
  ]

  const healthOk = status?.health && typeof status.health === 'object' && status.health.ok === true

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h1 className="text-2xl font-semibold m-0">{t('pages.mybots.title')}</h1>
        <button type="button" className="btn btn-sm" onClick={() => void loadStatus()}>
          {t('common.refresh')}
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-2 mb-4 p-3 rounded-lg bg-base-100 border border-base-300">
        <label className="form-control w-full max-w-xs">
          <span className="label py-0.5">
            <span className="label-text text-xs">{t('mybots.characterId')}</span>
          </span>
          <input
            className="input input-bordered input-sm"
            placeholder={t('mybots.characterPlaceholder')}
            value={charId}
            onChange={(e) => setCharId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void loadCharacter(charId).then(() => refreshCharRelated(charId.trim()))
            }}
          />
        </label>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={!status?.configured}
          onClick={() => void loadCharacter(charId).then(() => refreshCharRelated(charId.trim()))}
        >
          {t('mybots.loadCharacter')}
        </button>
        {activeChar && (
          <span className="text-sm text-base-content/60 self-center">
            {t('mybots.activeCharacter')}: <strong>{activeChar}</strong>
            {snap?.online === false && <span className="badge badge-warning badge-sm ml-2">{t('mybots.offline')}</span>}
            {snap?.selfbot && <span className="badge badge-success badge-sm ml-2">Selfbot</span>}
          </span>
        )}
      </div>

      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: 'overview',
            label: t('mybots.tabOverview'),
            children: (
              <div>
                <PanelIntro>{t('mybots.overviewHint')}</PanelIntro>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                  <StatCard
                    title={t('mybots.apiStatus')}
                    desc={t('mybots.apiStatusHint')}
                    value={
                      !status
                        ? '-'
                        : !status.configured
                          ? t('mybots.notConfigured')
                          : healthOk
                            ? t('mybots.healthy')
                            : t('mybots.unreachable')
                    }
                  />
                  <StatCard
                    title={t('mybots.endpoint')}
                    desc={t('mybots.endpointHint')}
                    value={status?.configured ? `${status.host}:${status.port}` : '-'}
                  />
                  <StatCard
                    title={t('mybots.service')}
                    desc={t('mybots.serviceHint')}
                    value={
                      status?.health && 'service' in status.health
                        ? String(status.health.service ?? '-')
                        : '-'
                    }
                  />
                  <StatCard
                    title={t('mybots.version')}
                    desc={t('mybots.versionHint')}
                    value={
                      status?.health && 'version' in status.health
                        ? String(status.health.version ?? '-')
                        : '-'
                    }
                  />
                </div>
                {!status?.configured && (
                  <div className="alert alert-warning text-sm">
                    <span>{t('mybots.configHint')}</span>
                  </div>
                )}
                {status?.configured && status.health && 'error' in status.health && status.health.error && (
                  <div className="alert alert-error text-sm mt-3">
                    <span>{status.health.error}</span>
                  </div>
                )}
                <div className="mt-4 text-sm text-base-content/60 space-y-1">
                  <p className="m-0">{t('mybots.noteSelfbot')}</p>
                  <p className="m-0">{t('mybots.noteRpgQuest')}</p>
                </div>
              </div>
            ),
          },
          {
            key: 'character',
            label: t('mybots.tabCharacter'),
            children: (
              <div>
                <PanelIntro>{t('mybots.characterHint')}</PanelIntro>
                {!activeChar || !snap ? (
                  <p className="text-sm text-base-content/50 m-0">{t('mybots.loadFirst')}</p>
                ) : (
                  <div className="space-y-4 max-w-3xl">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                      <div>
                        <div className="text-xs text-base-content/50">{t('characters.name')}</div>
                        <div className="font-medium">{snap.name ?? activeChar}</div>
                      </div>
                      <div>
                        <div className="text-xs text-base-content/50">GUID</div>
                        <div className="font-medium">{snap.guid ?? '-'}</div>
                      </div>
                      <div>
                        <div className="text-xs text-base-content/50">{t('characters.level')}</div>
                        <div className="font-medium">{snap.level ?? '-'}</div>
                      </div>
                      <div>
                        <div className="text-xs text-base-content/50">{t('characters.map')}</div>
                        <div className="font-medium">
                          {snap.map ?? '-'} / zone {snap.zone ?? '-'}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-base-content/50">XYZ</div>
                        <div className="font-medium font-mono text-xs">
                          {fmtCoord(snap.x)}, {fmtCoord(snap.y)}, {fmtCoord(snap.z)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-base-content/50">HP / Power</div>
                        <div className="font-medium">
                          {snap.hp ? `${snap.hp[0]}/${snap.hp[1]}` : '-'} ·{' '}
                          {snap.power ? `${snap.power[0]}/${snap.power[1]}` : '-'}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-base-content/50">Latency</div>
                        <div className="font-medium">{snap.latencyMs != null ? `${snap.latencyMs} ms` : '-'}</div>
                      </div>
                      <div>
                        <div className="text-xs text-base-content/50">Selfbot</div>
                        <div className="font-medium">{snap.selfbot ? t('common.yes') : t('common.no')}</div>
                      </div>
                      <div>
                        <div className="text-xs text-base-content/50">{t('mybots.currentJob')}</div>
                        <div className="font-medium">
                          {snap.job ? `${snap.job.type ?? '?'} (${snap.job.status ?? '?'})` : t('mybots.noJob')}
                        </div>
                      </div>
                    </div>
                    {gm ? (
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className="btn btn-sm btn-primary" onClick={() => setSelfbot(true)}>
                          {t('mybots.enableSelfbot')}
                        </button>
                        <button type="button" className="btn btn-sm" onClick={() => setSelfbot(false)}>
                          {t('mybots.disableSelfbot')}
                        </button>
                        <button type="button" className="btn btn-sm" onClick={() => void refreshCharRelated()}>
                          {t('common.refresh')}
                        </button>
                      </div>
                    ) : (
                      <p className="text-sm text-base-content/50 m-0">{t('mybots.gmOnly')}</p>
                    )}
                  </div>
                )}
              </div>
            ),
          },
          {
            key: 'jobs',
            label: t('mybots.tabJobs'),
            children: (
              <div>
                <PanelIntro>{t('mybots.jobsHint')}</PanelIntro>
                {!activeChar ? (
                  <p className="text-sm text-base-content/50 m-0">{t('mybots.loadFirst')}</p>
                ) : (
                  <div className="space-y-6">
                    {gm && (
                      <section className="space-y-3 max-w-3xl p-4 rounded-lg border border-base-300 bg-base-100">
                        <h3 className="text-sm font-semibold m-0">{t('mybots.createJob')}</h3>
                        <div className="flex flex-wrap gap-3 items-end">
                          <label className="form-control">
                            <span className="label py-0.5">
                              <span className="label-text text-xs">{t('mybots.jobType')}</span>
                            </span>
                            <Select
                              className="select-sm w-44"
                              value={jobType}
                              onChange={(v) => v && setJobType(v as JobType)}
                              options={[
                                { value: 'move_to', label: 'move_to' },
                                { value: 'complete_quest', label: 'complete_quest' },
                                { value: 'patrol', label: 'patrol' },
                                { value: 'script', label: 'script' },
                              ]}
                            />
                          </label>
                          <label className="label cursor-pointer gap-2 py-0">
                            <input
                              type="checkbox"
                              className="checkbox checkbox-sm"
                              checked={replaceJob}
                              onChange={(e) => setReplaceJob(e.target.checked)}
                            />
                            <span className="label-text text-xs">{t('mybots.replaceJob')}</span>
                          </label>
                        </div>

                        {jobType === 'move_to' && (
                          <div className="space-y-2">
                            <div className="flex gap-2">
                              <button
                                type="button"
                                className={`btn btn-xs ${moveMode === 'xyz' ? 'btn-active' : ''}`}
                                onClick={() => setMoveMode('xyz')}
                              >
                                XYZ
                              </button>
                              <button
                                type="button"
                                className={`btn btn-xs ${moveMode === 'entry' ? 'btn-active' : ''}`}
                                onClick={() => setMoveMode('entry')}
                              >
                                NPC entry
                              </button>
                            </div>
                            {moveMode === 'xyz' ? (
                              <div className="flex flex-wrap gap-2">
                                <input
                                  className="input input-bordered input-sm w-28"
                                  placeholder="x"
                                  value={moveX}
                                  onChange={(e) => setMoveX(e.target.value)}
                                />
                                <input
                                  className="input input-bordered input-sm w-28"
                                  placeholder="y"
                                  value={moveY}
                                  onChange={(e) => setMoveY(e.target.value)}
                                />
                                <input
                                  className="input input-bordered input-sm w-28"
                                  placeholder="z"
                                  value={moveZ}
                                  onChange={(e) => setMoveZ(e.target.value)}
                                />
                                <input
                                  className="input input-bordered input-sm w-24"
                                  placeholder="dist"
                                  value={moveDist}
                                  onChange={(e) => setMoveDist(e.target.value)}
                                />
                                {snap?.x != null && (
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-xs"
                                    onClick={() => {
                                      setMoveX(String(snap.x))
                                      setMoveY(String(snap.y))
                                      setMoveZ(String(snap.z))
                                    }}
                                  >
                                    {t('mybots.useCurrentPos')}
                                  </button>
                                )}
                              </div>
                            ) : (
                              <input
                                className="input input-bordered input-sm w-40"
                                placeholder="entry"
                                value={moveEntry}
                                onChange={(e) => setMoveEntry(e.target.value)}
                              />
                            )}
                          </div>
                        )}

                        {jobType === 'complete_quest' && (
                          <div className="flex flex-wrap gap-2">
                            <input
                              className="input input-bordered input-sm w-32"
                              placeholder="questId"
                              value={questId}
                              onChange={(e) => setQuestId(e.target.value)}
                            />
                            <input
                              className="input input-bordered input-sm w-32"
                              placeholder="giverEntry"
                              value={giverEntry}
                              onChange={(e) => setGiverEntry(e.target.value)}
                            />
                            <input
                              className="input input-bordered input-sm w-32"
                              placeholder="turninEntry"
                              value={turninEntry}
                              onChange={(e) => setTurninEntry(e.target.value)}
                            />
                          </div>
                        )}

                        {jobType === 'patrol' && (
                          <input
                            className="input input-bordered input-sm w-64"
                            placeholder="patrolId"
                            value={patrolId}
                            onChange={(e) => setPatrolId(e.target.value)}
                          />
                        )}

                        {jobType === 'script' && (
                          <textarea
                            className="textarea textarea-bordered font-mono text-xs w-full min-h-32"
                            value={scriptSteps}
                            onChange={(e) => setScriptSteps(e.target.value)}
                          />
                        )}

                        <button type="button" className="btn btn-sm btn-primary" onClick={() => void createJob()}>
                          {t('mybots.submitJob')}
                        </button>
                      </section>
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" className="btn btn-sm" onClick={() => void loadJobs(activeChar)}>
                        {t('common.refresh')}
                      </button>
                      {gm && (
                        <button type="button" className="btn btn-sm btn-error" onClick={cancelAllJobs}>
                          {t('mybots.cancelAllJobs')}
                        </button>
                      )}
                    </div>
                    <DataTable columns={jobColumns} dataSource={jobs} rowKey={(r) => r.id ?? r.jobId ?? String(Math.random())} />

                    {jobDetail && (
                      <div className="p-4 rounded-lg border border-base-300 bg-base-100">
                        <div className="flex justify-between items-center mb-2">
                          <h3 className="text-sm font-semibold m-0">
                            {t('mybots.jobDetail')}: {jobDetail.id ?? jobDetail.jobId}
                          </h3>
                          <button type="button" className="btn btn-ghost btn-xs" onClick={() => setJobDetail(null)}>
                            {t('mybots.close')}
                          </button>
                        </div>
                        <pre className="m-0 text-xs whitespace-pre-wrap overflow-auto max-h-80">
                          {JSON.stringify(jobDetail, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ),
          },
          {
            key: 'events',
            label: t('mybots.tabEvents'),
            children: (
              <div>
                <PanelIntro>{t('mybots.eventsHint')}</PanelIntro>
                {!activeChar ? (
                  <p className="text-sm text-base-content/50 m-0">{t('mybots.loadFirst')}</p>
                ) : (
                  <>
                    <button type="button" className="btn btn-sm mb-3" onClick={() => void loadEvents(activeChar)}>
                      {t('common.refresh')}
                    </button>
                    <DataTable columns={eventColumns} dataSource={events} rowKey={(r) => String(r.id)} />
                  </>
                )}
              </div>
            ),
          },
          {
            key: 'patrols',
            label: t('mybots.tabPatrols'),
            children: (
              <div>
                <PanelIntro>{t('mybots.patrolsHint')}</PanelIntro>
                {!status?.configured ? (
                  <p className="text-sm text-base-content/50 m-0">{t('mybots.notConfigured')}</p>
                ) : (
                  <div className="space-y-6">
                    {gm && (
                      <section className="space-y-2 max-w-3xl p-4 rounded-lg border border-base-300 bg-base-100">
                        <h3 className="text-sm font-semibold m-0">{t('mybots.savePatrol')}</h3>
                        <div className="flex flex-wrap gap-2">
                          <input
                            className="input input-bordered input-sm w-48"
                            placeholder="id"
                            value={patrolFormId}
                            onChange={(e) => setPatrolFormId(e.target.value)}
                          />
                          <input
                            className="input input-bordered input-sm w-64"
                            placeholder={t('mybots.patrolName')}
                            value={patrolFormName}
                            onChange={(e) => setPatrolFormName(e.target.value)}
                          />
                        </div>
                        <textarea
                          className="textarea textarea-bordered font-mono text-xs w-full min-h-28"
                          value={patrolFormWaypoints}
                          onChange={(e) => setPatrolFormWaypoints(e.target.value)}
                        />
                        <button type="button" className="btn btn-sm btn-primary" onClick={() => void savePatrol()}>
                          {t('mybots.savePatrol')}
                        </button>
                      </section>
                    )}
                    <button type="button" className="btn btn-sm" onClick={() => void loadPatrols()}>
                      {t('common.refresh')}
                    </button>
                    <DataTable columns={patrolColumns} dataSource={patrols} rowKey={(r) => r.id} />
                  </div>
                )}
              </div>
            ),
          },
        ]}
      />

      {pending && (
        <ConfirmDanger
          open
          title={pending.title}
          description={pending.description}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const run = pending.run
            setPending(null)
            void run()
              .then(() => toast.success(t('common.ok')))
              .catch((err) => toast.error(errorMessage(err, t)))
          }}
        />
      )}
    </div>
  )
}
